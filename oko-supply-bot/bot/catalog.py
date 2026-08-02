import json
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.json"


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_supplier(catalog: dict, name: str) -> dict | None:
    return next((s for s in catalog["suppliers"] if s["name"] == name), None)


def get_product(catalog: dict, name: str) -> dict | None:
    return next((p for p in catalog["products"] if p["name"] == name), None)
