"""
Веб-сервер формы заказа.

Отдаёт webapp/order.html и обслуживает:
  GET    /api/catalog                — текущий каталог (товары + поставщики)
  POST   /api/order                  — принимает натапанные позиции, группирует
                                        по поставщикам и реально отправляет
                                        через тот же Telethon-клиент, что и
                                        send_order.py
  POST   /api/catalog/products       — добавить товар
  PUT    /api/catalog/products/{idx} — изменить товар
  DELETE /api/catalog/products/{idx} — удалить товар
  POST   /api/catalog/suppliers       — добавить поставщика
  PUT    /api/catalog/suppliers/{idx} — изменить поставщика (переименование
                                         каскадно обновляет supplier у товаров)
  DELETE /api/catalog/suppliers/{idx} — удалить поставщика вместе с его товарами
  GET    /api/chats                  — последние диалоги Telethon-клиента
                                        (id, имя, тип) для выбора chat_id
                                        прямо в карточке поставщика
  GET    /api/autoresponder                — шаблоны автоответчика + активный id
  POST   /api/autoresponder/templates       — добавить шаблон
  PUT    /api/autoresponder/templates/{id}  — изменить шаблон
  DELETE /api/autoresponder/templates/{id}  — удалить шаблон (снимает с активных)
  POST   /api/autoresponder/activate        — {"id": "..."} включить шаблон,
                                               {"id": null} выключить автоответчик
  GET    /api/orders                 — история отправленных заказов (см.
                                        orders_store.py), новые первыми
  POST   /api/broadcast              — {"text": "...", "suppliers": [имена]}
                                        рассылка ТОЛЬКО уже известным
                                        поставщикам (у кого задан chat_id) —
                                        с паузой между отправками, см.
                                        api_broadcast ниже

Один процесс держит один долгоживущий авторизованный TelegramClient —
логиниться заново не нужно, session уже создана (см. README).
"""

import asyncio
import os
import random
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv
from telethon.errors import FloodWaitError

import autoresponder_store
import orders_store
from catalog import get_product, get_supplier, load_catalog, save_catalog
from client import SESSION_NAME, get_client, start_client
from message import group_by_supplier, render_message

WEBAPP_DIR = Path(__file__).resolve().parent.parent / "webapp"

# Отдельный session-файл от autoresponder.py — один и тот же .session не
# рассчитан на одновременную запись из двух процессов (SQLite "database is
# locked", вплоть до фатального краха апдейт-лупа Telethon).
WEBAPP_SESSION_NAME = os.environ.get("WEBAPP_SESSION_NAME", f"{SESSION_NAME}_webapp")

# Каталог редактируется через несколько ручек ниже — оборачиваем
# read-modify-write в лок, чтобы два почти одновременных сохранения не
# затёрли друг друга.
catalog_lock = asyncio.Lock()
autoresponder_lock = asyncio.Lock()
orders_lock = asyncio.Lock()

routes = web.RouteTableDef()


@routes.get("/")
async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEBAPP_DIR / "index.html")


# Старая форма (только заказ + управление каталогом, без автоответчика-модалки
# и без нового дизайна) оставлена доступной напрямую по ссылке — вместе с ней
# работает /api/catalog/* и остальные общие ручки ниже, так что она не требует
# отдельного бэкенда.
@routes.get("/order.html")
async def order_legacy(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEBAPP_DIR / "order.html")


@routes.get("/api/catalog")
async def api_catalog(request: web.Request) -> web.Response:
    return web.json_response(load_catalog())


# Реальный статус Telethon-соединения — используется формой (карточка
# "Telegram-аккаунт" в Настройках), чтобы не изображать "всё ок", когда
# клиент на самом деле отвалился (см. STATUS.md — именно так выглядел баг
# с chat_id: /api/chats тихо падал 500-й, потому что client.iter_dialogs
# бросал ConnectionError, а форма никак не показывала причину).
@routes.get("/api/status")
async def api_status(request: web.Request) -> web.Response:
    client = request.app["tg_client"]
    connected = client.is_connected()
    me_name = None
    if connected:
        try:
            me = await client.get_me()
            me_name = me.first_name if me else None
        except Exception:
            connected = False
    return web.json_response({"connected": connected, "me": me_name})


@routes.get("/api/chats")
async def api_chats(request: web.Request) -> web.Response:
    """Последние диалоги Telethon-клиента — чтобы выбрать chat_id из формы,
    не вызывая list_chats.py в терминале."""
    client = request.app["tg_client"]
    chats = []
    async for dialog in client.iter_dialogs(limit=50):
        kind = "группа" if dialog.is_group else ("канал" if dialog.is_channel else "личный чат")
        chats.append({"id": dialog.id, "name": dialog.name, "type": kind})
    return web.json_response(chats)


@routes.post("/api/order")
async def api_order(request: web.Request) -> web.Response:
    payload = await request.json()
    items = payload.get("items", [])
    supplier_meta = payload.get("supplierMeta", {})

    catalog = load_catalog()
    order_lines = []
    for entry in items:
        product = get_product(catalog, entry["product"])
        if not product:
            continue
        order_lines.append({**product, "qty": entry["qty"]})

    grouped = group_by_supplier(order_lines)
    client = request.app["tg_client"]

    results = []
    for supplier_name, lines in grouped.items():
        supplier = get_supplier(catalog, supplier_name)
        meta = supplier_meta.get(supplier_name, {})

        if not supplier or not supplier.get("chat_id"):
            results.append({"supplier": supplier_name, "status": "skipped", "reason": "chat_id не задан"})
            continue

        delivery_date_str = meta.get("delivery_date")
        delivery_date = (
            date.fromisoformat(delivery_date_str) if delivery_date_str else date.today() + timedelta(days=1)
        )
        text = render_message(lines, delivery_date=delivery_date, comment=meta.get("comment", ""))

        try:
            await client.send_message(supplier["chat_id"], text)
            results.append({"supplier": supplier_name, "status": "sent"})
        except Exception as exc:  # noqa: BLE001 — reportится клиенту как есть
            results.append({"supplier": supplier_name, "status": "error", "reason": str(exc)})

    statuses = {r["status"] for r in results}
    overall = "sent" if statuses == {"sent"} else ("partial" if "sent" in statuses else "failed")

    prices = [line.get("price") for line in order_lines]
    total_price = (
        sum(line["qty"] * line["price"] for line in order_lines)
        if order_lines and all(p is not None for p in prices)
        else None
    )

    order_entry = {
        "id": uuid.uuid4().hex[:8],
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "suppliers_count": len(grouped),
        "items_count": sum(line["qty"] for line in order_lines),
        "total_price": total_price,
        "status": overall,
        "results": results,
    }
    async with orders_lock:
        orders_store.add_order(order_entry)

    return web.json_response({"results": results})


@routes.get("/api/orders")
async def api_orders(request: web.Request) -> web.Response:
    return web.json_response(orders_store.load_orders())


# Рассылка — сознательно ограничена уже известными поставщиками (у кого есть
# chat_id, то есть переписка уже идёт через заказы). Это НЕ инструмент для
# холодных/новых контактов: Telegram резко банит личные аккаунты именно за
# массовые ПЕРВЫЕ сообщения незнакомым людям (PeerFloodError). Даже для
# безопасной аудитории отправляем по одному с паузой, а не разом — это
# нормальная гигиена для userbot, не изображение "живого набора текста".
@routes.post("/api/broadcast")
async def api_broadcast(request: web.Request) -> web.Response:
    payload = await request.json()
    text = payload.get("text", "").strip()
    if not text:
        raise web.HTTPBadRequest(text="Текст сообщения обязателен")
    only_names = payload.get("suppliers")  # None = все с chat_id

    catalog = load_catalog()
    targets = [
        s
        for s in catalog["suppliers"]
        if s.get("chat_id") and (only_names is None or s["name"] in only_names)
    ]

    client = request.app["tg_client"]
    results = []
    for i, supplier in enumerate(targets):
        if i > 0:
            await asyncio.sleep(random.uniform(2.5, 5.5))
        try:
            await client.send_message(supplier["chat_id"], text)
            results.append({"supplier": supplier["name"], "status": "sent"})
        except FloodWaitError as exc:
            results.append(
                {
                    "supplier": supplier["name"],
                    "status": "error",
                    "reason": f"Telegram просит подождать {exc.seconds} сек — рассылка остановлена, оставшихся не трогали",
                }
            )
            break
        except Exception as exc:  # noqa: BLE001
            results.append({"supplier": supplier["name"], "status": "error", "reason": str(exc)})

    return web.json_response({"results": results})


def _parse_chat_id(raw) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="chat_id должен быть числом")


def _parse_price(raw) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="Цена должна быть числом")


def _product_from_body(body: dict) -> dict:
    if not body.get("name", "").strip():
        raise web.HTTPBadRequest(text="Название товара обязательно")
    if not body.get("supplier", "").strip():
        raise web.HTTPBadRequest(text="Поставщик обязателен")
    return {
        "name": body["name"].strip(),
        "unit": body.get("unit", "").strip(),
        "supplier": body["supplier"].strip(),
        "category": (body.get("category") or "").strip() or None,
        "price": _parse_price(body.get("price")),
        "photo": body.get("photo") or None,
    }


def _supplier_from_body(body: dict, note: str = "") -> dict:
    if not body.get("name", "").strip():
        raise web.HTTPBadRequest(text="Название поставщика обязательно")
    return {
        "name": body["name"].strip(),
        "phone": body.get("phone", "").strip(),
        "telegram": body.get("telegram", "").strip(),
        "note": note,
        "chat_id": _parse_chat_id(body.get("chat_id")),
    }


@routes.post("/api/catalog/products")
async def create_product(request: web.Request) -> web.Response:
    body = await request.json()
    async with catalog_lock:
        catalog = load_catalog()
        product = _product_from_body(body)
        catalog["products"].append(product)
        save_catalog(catalog)
        index = len(catalog["products"]) - 1
    return web.json_response({"index": index, "product": product})


@routes.put("/api/catalog/products/{idx}")
async def update_product(request: web.Request) -> web.Response:
    idx = int(request.match_info["idx"])
    body = await request.json()
    async with catalog_lock:
        catalog = load_catalog()
        if not (0 <= idx < len(catalog["products"])):
            raise web.HTTPNotFound()
        catalog["products"][idx] = _product_from_body(body)
        save_catalog(catalog)
    return web.json_response({"ok": True})


@routes.delete("/api/catalog/products/{idx}")
async def delete_product(request: web.Request) -> web.Response:
    idx = int(request.match_info["idx"])
    async with catalog_lock:
        catalog = load_catalog()
        if not (0 <= idx < len(catalog["products"])):
            raise web.HTTPNotFound()
        catalog["products"].pop(idx)
        save_catalog(catalog)
    return web.json_response({"ok": True})


@routes.post("/api/catalog/suppliers")
async def create_supplier(request: web.Request) -> web.Response:
    body = await request.json()
    async with catalog_lock:
        catalog = load_catalog()
        supplier = _supplier_from_body(body)
        catalog["suppliers"].append(supplier)
        save_catalog(catalog)
        index = len(catalog["suppliers"]) - 1
    return web.json_response({"index": index, "supplier": supplier})


@routes.put("/api/catalog/suppliers/{idx}")
async def update_supplier(request: web.Request) -> web.Response:
    idx = int(request.match_info["idx"])
    body = await request.json()
    async with catalog_lock:
        catalog = load_catalog()
        if not (0 <= idx < len(catalog["suppliers"])):
            raise web.HTTPNotFound()
        old = catalog["suppliers"][idx]
        updated = _supplier_from_body(body, note=old.get("note", ""))
        catalog["suppliers"][idx] = updated
        if updated["name"] != old["name"]:
            for p in catalog["products"]:
                if p["supplier"] == old["name"]:
                    p["supplier"] = updated["name"]
        save_catalog(catalog)
    return web.json_response({"ok": True})


@routes.delete("/api/catalog/suppliers/{idx}")
async def delete_supplier(request: web.Request) -> web.Response:
    idx = int(request.match_info["idx"])
    async with catalog_lock:
        catalog = load_catalog()
        if not (0 <= idx < len(catalog["suppliers"])):
            raise web.HTTPNotFound()
        name = catalog["suppliers"][idx]["name"]
        catalog["suppliers"].pop(idx)
        catalog["products"] = [p for p in catalog["products"] if p["supplier"] != name]
        save_catalog(catalog)
    return web.json_response({"ok": True})


@routes.get("/api/autoresponder")
async def api_autoresponder_get(request: web.Request) -> web.Response:
    return web.json_response(autoresponder_store.load_config())


@routes.post("/api/autoresponder/templates")
async def api_autoresponder_create(request: web.Request) -> web.Response:
    body = await request.json()
    name = body.get("name", "").strip()
    text = body.get("text", "").strip()
    if not name or not text:
        raise web.HTTPBadRequest(text="Название и текст шаблона обязательны")
    async with autoresponder_lock:
        config = autoresponder_store.load_config()
        template = {"id": uuid.uuid4().hex[:8], "name": name, "text": text}
        config["templates"].append(template)
        autoresponder_store.save_config(config)
    return web.json_response(template)


@routes.put("/api/autoresponder/templates/{tid}")
async def api_autoresponder_update(request: web.Request) -> web.Response:
    tid = request.match_info["tid"]
    body = await request.json()
    name = body.get("name", "").strip()
    text = body.get("text", "").strip()
    if not name or not text:
        raise web.HTTPBadRequest(text="Название и текст шаблона обязательны")
    async with autoresponder_lock:
        config = autoresponder_store.load_config()
        template = next((t for t in config["templates"] if t["id"] == tid), None)
        if not template:
            raise web.HTTPNotFound()
        template["name"] = name
        template["text"] = text
        autoresponder_store.save_config(config)
    return web.json_response({"ok": True})


@routes.delete("/api/autoresponder/templates/{tid}")
async def api_autoresponder_delete(request: web.Request) -> web.Response:
    tid = request.match_info["tid"]
    async with autoresponder_lock:
        config = autoresponder_store.load_config()
        config["templates"] = [t for t in config["templates"] if t["id"] != tid]
        if config.get("active_template_id") == tid:
            config["active_template_id"] = None
        autoresponder_store.save_config(config)
    return web.json_response({"ok": True})


@routes.post("/api/autoresponder/activate")
async def api_autoresponder_activate(request: web.Request) -> web.Response:
    body = await request.json()
    tid = body.get("id")
    async with autoresponder_lock:
        config = autoresponder_store.load_config()
        if tid is not None and not any(t["id"] == tid for t in config["templates"]):
            raise web.HTTPNotFound()
        config["active_template_id"] = tid
        autoresponder_store.save_config(config)
    return web.json_response({"ok": True})


async def on_startup(app: web.Application) -> None:
    app["tg_client"] = await start_client(get_client(WEBAPP_SESSION_NAME))


async def on_cleanup(app: web.Application) -> None:
    await app["tg_client"].disconnect()


def create_app() -> web.Application:
    app = web.Application()
    app.add_routes(routes)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    load_dotenv()
    port = int(os.environ.get("WEBAPP_PORT", "8081"))
    web.run_app(create_app(), port=port)
