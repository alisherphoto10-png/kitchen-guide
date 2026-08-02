import os

from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
PHONE = os.environ.get("TG_PHONE")
SESSION_NAME = os.environ.get("TG_SESSION_NAME", "oko_supply_bot")


def get_client() -> TelegramClient:
    return TelegramClient(SESSION_NAME, API_ID, API_HASH)
