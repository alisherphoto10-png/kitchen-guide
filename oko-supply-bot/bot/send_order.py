"""
Тестовая отправка заказа поставщикам.

Пока нет webapp — тапнутые позиции задаются прямо здесь, в TEST_ORDER.
Когда появится форма (webapp), она будет отдавать такой же список
{"product": ..., "qty": ...} сюда вместо константы.
"""

import asyncio
from datetime import date, timedelta

from catalog import get_product, get_supplier, load_catalog
from client import get_client, start_client
from message import group_by_supplier, render_message

TEST_ORDER = [
    {"product": "Романо", "qty": 2},
    {"product": "шпинат", "qty": 1},
]


async def main() -> None:
    catalog = load_catalog()

    order_lines = []
    for entry in TEST_ORDER:
        product = get_product(catalog, entry["product"])
        if not product:
            print(f"[пропущено] товар «{entry['product']}» не найден в каталоге")
            continue
        order_lines.append({**product, "qty": entry["qty"]})

    grouped = group_by_supplier(order_lines)

    client = await start_client(get_client())
    async with client:
        for supplier_name, lines in grouped.items():
            supplier = get_supplier(catalog, supplier_name)
            if not supplier or not supplier.get("chat_id"):
                print(f"[пропущено] у поставщика «{supplier_name}» не задан chat_id в data/catalog.json")
                continue

            text = render_message(lines, delivery_date=date.today() + timedelta(days=1))
            await client.send_message(supplier["chat_id"], text)
            print(f"[отправлено] {supplier_name}: {len(lines)} позиций")


if __name__ == "__main__":
    asyncio.run(main())
