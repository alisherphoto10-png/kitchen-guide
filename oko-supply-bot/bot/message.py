from collections import defaultdict
from datetime import date


def group_by_supplier(order_lines: list[dict]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    for line in order_lines:
        grouped[line["supplier"]].append(line)
    return grouped


def render_message(lines: list[dict], delivery_date: date, comment: str = "") -> str:
    date_str = delivery_date.strftime("%d.%m.%Y")
    items_text = "\n".join(f'{l["name"]} — {l["qty"]} {l["unit"]}' for l in lines)
    comment_block = f"\n\n{comment.strip()}" if comment.strip() else ""
    return f"Заказ на {date_str}:\n{items_text}{comment_block}\n\nСпасибо!"
