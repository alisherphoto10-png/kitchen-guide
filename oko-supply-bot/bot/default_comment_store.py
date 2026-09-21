import json
from pathlib import Path

COMMENT_PATH = Path(__file__).resolve().parent.parent / "data" / "default_comment.json"


def load_comment(path: Path = COMMENT_PATH) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("text") or ""
    except FileNotFoundError:
        return ""


def save_comment(text: str, path: Path = COMMENT_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"text": text}, f, ensure_ascii=False, indent=2)
        f.write("\n")
