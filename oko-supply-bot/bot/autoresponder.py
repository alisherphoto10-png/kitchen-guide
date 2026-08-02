"""
Автоответчик на личные сообщения.

Активный шаблон и весь список шаблонов хранятся в data/autoresponder.json —
управлять можно либо отсюда, командами в Избранном (Saved Messages):
  /busy — включить шаблон с id "busy" (по умолчанию — "Занят")
  /free — выключить автоответчик
либо через саму форму (webapp_server.py, раздел «Автоответчик»), где можно
заводить любые сценарии («Занят», «Выходной» и т.п.), не только эти два.

Пока активен любой шаблон — на каждый новый личный чат уходит его текст,
один раз, пока чат не прочитан. Как только Алишер открывает и читает чат
(даже не отвечая) — при следующем сообщении оттуда автоответ уйдёт снова:
раз он посмотрел и не ответил по-настоящему, человек не должен решить,
что его просто игнорируют.
"""

import asyncio

from telethon import events

from autoresponder_store import get_active_text, load_config, save_config
from client import get_client, start_client

BUSY_COMMAND = "/busy"
FREE_COMMAND = "/free"
DEFAULT_TEMPLATE_ID = "busy"

already_replied: set[int] = set()


async def main() -> None:
    client = await start_client(get_client())
    me = await client.get_me()

    @client.on(events.NewMessage(outgoing=True, chats="me"))
    async def toggle(event):
        text = event.raw_text.strip().lower()
        if text == BUSY_COMMAND:
            config = load_config()
            target_id = DEFAULT_TEMPLATE_ID
            if not any(t["id"] == target_id for t in config["templates"]):
                target_id = config["templates"][0]["id"] if config["templates"] else None
            if target_id is None:
                await event.reply("Нет ни одного шаблона — добавь через форму.")
                return
            config["active_template_id"] = target_id
            save_config(config)
            already_replied.clear()
            name = next(t["name"] for t in config["templates"] if t["id"] == target_id)
            await event.reply(f"Автоответчик включён: «{name}».")
        elif text == FREE_COMMAND:
            config = load_config()
            config["active_template_id"] = None
            save_config(config)
            await event.reply("Автоответчик выключен.")

    @client.on(events.NewMessage(incoming=True))
    async def autoreply(event):
        if not event.is_private:
            return
        reply_text = get_active_text(load_config())
        if not reply_text:
            return
        chat_id = event.chat_id
        if chat_id in already_replied:
            return
        already_replied.add(chat_id)
        await event.reply(reply_text)

    @client.on(events.MessageRead(inbox=True))
    async def on_read(event):
        already_replied.discard(event.chat_id)

    print(f"Автоответчик запущен от имени {me.first_name}.")
    print(f"Команды в Избранном: {BUSY_COMMAND} / {FREE_COMMAND}")
    print("Другие сценарии — через форму, раздел «Автоответчик».")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
