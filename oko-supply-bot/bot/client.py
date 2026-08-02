import os

from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
PHONE = os.environ.get("TG_PHONE")
SESSION_NAME = os.environ.get("TG_SESSION_NAME", "oko_supply_bot")


def get_client(session_name: str | None = None) -> TelegramClient:
    return TelegramClient(session_name or SESSION_NAME, API_ID, API_HASH)


async def start_client(client: TelegramClient) -> TelegramClient:
    """client.start() ignores TG_PHONE and always asks interactively — pass it explicitly."""
    if PHONE:
        await client.start(phone=PHONE)
    else:
        await client.start()
    return client
