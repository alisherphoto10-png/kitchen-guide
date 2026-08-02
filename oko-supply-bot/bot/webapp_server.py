"""
Веб-сервер формы заказа.

Отдаёт webapp/order.html и обслуживает две ручки:
  GET  /api/catalog  — текущий каталог (товары + поставщики)
  POST /api/order    — принимает натапанные позиции, группирует по
                        поставщикам и реально отправляет через тот же
                        Telethon-клиент, что и send_order.py

Один процесс держит один долгоживущий авторизованный TelegramClient —
логиниться заново не нужно, session уже создана (см. README).
"""

import os
from datetime import date, timedelta
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv

from catalog import get_product, get_supplier, load_catalog
from client import SESSION_NAME, get_client, start_client
from message import group_by_supplier, render_message

WEBAPP_DIR = Path(__file__).resolve().parent.parent / "webapp"

# Отдельный session-файл от autoresponder.py — один и тот же .session не
# рассчитан на одновременную запись из двух процессов (SQLite "database is
# locked", вплоть до фатального краха апдейт-лупа Telethon).
WEBAPP_SESSION_NAME = os.environ.get("WEBAPP_SESSION_NAME", f"{SESSION_NAME}_webapp")

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
