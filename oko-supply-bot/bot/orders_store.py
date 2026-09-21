import json
from pathlib import Path

ORDERS_PATH = Path(__file__).resolve().parent.parent / "data" / "orders.json"
MAX_HISTORY = 200


def load_orders(path: Path = ORDERS_PATH) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return []


def save_orders(orders: list[dict], path: Path = ORDERS_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(orders, f, ensure_ascii=False, indent=2)
        f.write("\n")


def add_order(entry: dict, path: Path = ORDERS_PATH) -> None:
    orders = load_orders(path)
    orders.insert(0, entry)
    save_orders(orders[:MAX_HISTORY], path)
