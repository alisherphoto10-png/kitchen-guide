import json
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "data" / "order_template.json"
DEFAULT_TEMPLATE = "Заказ на {дата}:\n{товары}\n\n{комментарий}\n\nСпасибо!"


def load_template(path: Path = TEMPLATE_PATH) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("text") or DEFAULT_TEMPLATE
    except FileNotFoundError:
        return DEFAULT_TEMPLATE


def save_template(text: str, path: Path = TEMPLATE_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"text": text}, f, ensure_ascii=False, indent=2)
        f.write("\n")
