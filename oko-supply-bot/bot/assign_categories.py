"""
Разовый скрипт: проставляет категорию каждому товару в data/catalog.json по
ключевым словам в названии — чтобы не редактировать вручную все ~70 позиций
после того, как в форме появилось поле "Категория". Это стартовая догадка,
поправить неверно угаданное или дозаполнить пропущенное — прямо в форме.

Запуск (один раз, после обновления кода):
    python assign_categories.py
"""

from catalog import load_catalog, save_catalog

RULES: list[tuple[str, list[str]]] = [
    ("Молочная продукция", ["молок", "йогурт", "сливк", "сметан", "сыр", "лабне", "страчателла", "моцарелла"]),
    ("Мясо", ["мясо", "рибай", "фарш", "стейк", "мачете", "филе", "бёдра", "рёбра", "лапки", "каркас"]),
    ("Рыба и морепродукты", ["рыб", "сибас", "тунец", "форель", "креветк", "мидии", "кальмар", "угорь", "лосос"]),
    ("Овощи и фрукты", ["авокадо", "ягод", "шпинат", "романо", "батат", "картофел", "зелен"]),
    ("Соусы", ["соус", "кетчуп", "паста том", "устричн", "кимчи"]),
    ("Бакалея", ["мука", "оливк", "шоколад", "зефир", "паста", "каперс"]),
    ("Прочее", ["уголь", "яйц"]),
]


def guess_category(name: str) -> str | None:
    lowered = name.lower()
    for category, keywords in RULES:
        if any(kw in lowered for kw in keywords):
            return category
    return None


def main() -> None:
    catalog = load_catalog()
    updated = 0
    unresolved = []
    for product in catalog["products"]:
        if product.get("category"):
            continue
        guess = guess_category(product["name"])
        if guess:
            product["category"] = guess
            updated += 1
        else:
            unresolved.append(product["name"])
    save_catalog(catalog)
    print(f"Проставлена категория для {updated} из {len(catalog['products'])} товаров.")
    if unresolved:
        print("Без категории остались (уточнить вручную в форме):")
        for name in unresolved:
            print(f"  - {name}")


if __name__ == "__main__":
    main()
