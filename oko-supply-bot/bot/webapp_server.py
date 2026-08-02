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

Один процесс держит один долгоживущий авторизованный TelegramClient —
логиниться заново не нужно, session уже создана (см. README).
"""

import asyncio
import os
from datetime import date, timedelta
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv

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

routes = web.RouteTableDef()


@routes.get("/")
async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEBAPP_DIR / "order.html")


@routes.get("/api/catalog")
async def api_catalog(request: web.Request) -> web.Response:
    return web.json_response(load_catalog())


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

    return web.json_response({"results": results})


def _parse_chat_id(raw) -> int | None:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="chat_id должен быть числом")


def _product_from_body(body: dict) -> dict:
    if not body.get("name", "").strip():
        raise web.HTTPBadRequest(text="Название товара обязательно")
    if not body.get("supplier", "").strip():
        raise web.HTTPBadRequest(text="Поставщик обязателен")
    return {
        "name": body["name"].strip(),
        "unit": body.get("unit", "").strip(),
        "supplier": body["supplier"].strip(),
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
