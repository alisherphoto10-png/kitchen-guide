"""
Автоответчик на личные сообщения.

Переключение "занят/свободен" — командой в Избранном (Saved Messages):
  /busy — включить автоответчик
  /free — выключить

Пока "занят" — на каждый новый личный чат уходит фиксированный текст,
один раз за период "занят" (чтобы не спамить одному и тому же человеку).
"""

import asyncio

from telethon import events

from client import get_client

AUTO_REPLY_TEXT = "Алишер сейчас занят, ответит как освободится."
BUSY_COMMAND = "/busy"
FREE_COMMAND = "/free"

is_busy = False
already_replied: set[int] = set()


async def main() -> None:
    client = get_client()
    await client.start()
    me = await client.get_me()

    @client.on(events.NewMessage(outgoing=True, chats="me"))
    async def toggle(event):
        global is_busy, already_replied
        text = event.raw_text.strip().lower()
        if text == BUSY_COMMAND:
            is_busy = True
            already_replied = set()
            await event.reply("Автоответчик включён.")
        elif text == FREE_COMMAND:
            is_busy = False
            await event.reply("Автоответчик выключен.")

    @client.on(events.NewMessage(incoming=True))
    async def autoreply(event):
        if not is_busy or not event.is_private:
            return
        chat_id = event.chat_id
        if chat_id in already_replied:
            return
        already_replied.add(chat_id)
        await event.reply(AUTO_REPLY_TEXT)

    print(f"Автоответчик запущен от имени {me.first_name}.")
    print(f"Команды в Избранном: {BUSY_COMMAND} / {FREE_COMMAND}")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
