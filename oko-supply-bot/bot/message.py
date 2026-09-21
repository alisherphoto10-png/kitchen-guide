import re
from collections import defaultdict
from datetime import date

from order_template_store import DEFAULT_TEMPLATE


def group_by_supplier(order_lines: list[dict]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    for line in order_lines:
        grouped[line["supplier"]].append(line)
    return grouped


def render_message(lines: list[dict], delivery_date: date, comment: str = "", template: str | None = None) -> str:
    """Подставляет {дата}/{товары}/{комментарий} в шаблон (редактируется в
    форме, см. order_template_store.py). Если комментария нет — убираем
    осиротевшие пустые строки, которые остаются на месте {комментарий} в
    шаблоне по умолчанию (и в большинстве пользовательских вариантов той же
    формы), а не полагаемся на то, что каждый шаблон это учтёт сам."""
    if template is None:
        template = DEFAULT_TEMPLATE
    date_str = delivery_date.strftime("%d.%m.%Y")
    items_text = "\n".join(f'{l["name"]} — {l["qty"]} {l["unit"]}' for l in lines)
    comment_block = comment.strip()
    text = (
        template.replace("{дата}", date_str)
        .replace("{товары}", items_text)
        .replace("{комментарий}", comment_block)
    )
    if not comment_block:
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text
