import json
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "autoresponder.json"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict, path: Path = CONFIG_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write("\n")


def get_active_text(config: dict) -> str | None:
    active_id = config.get("active_template_id")
    if not active_id:
        return None
    template = next((t for t in config["templates"] if t["id"] == active_id), None)
    return template["text"] if template else None
