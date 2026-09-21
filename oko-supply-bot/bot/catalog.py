import json
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.json"

# Категории раньше жили только как захардкоженный список в webapp/index.html.
# Теперь это редактируемые данные (см. /api/catalog/categories/* в
# webapp_server.py) — сидируем тем же набором при первом обращении к файлу,
# где ключа "categories" ещё нет, чтобы не терять уже расставленные на
# товарах категории (assign_categories.py) без соответствующего списка.
DEFAULT_CATEGORIES = [
    "Молочная продукция",
    "Мясо",
    "Рыба и морепродукты",
    "Овощи и фрукты",
    "Бакалея",
    "Соусы",
    "Прочее",
]


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        catalog = json.load(f)
    catalog.setdefault("categories", list(DEFAULT_CATEGORIES))
    return catalog


def save_catalog(catalog: dict, path: Path = CATALOG_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")


def get_supplier(catalog: dict, name: str) -> dict | None:
    return next((s for s in catalog["suppliers"] if s["name"] == name), None)


def get_product(catalog: dict, name: str) -> dict | None:
    return next((p for p in catalog["products"] if p["name"] == name), None)
