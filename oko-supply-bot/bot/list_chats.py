"""
Печатает последние диалоги (личные чаты и группы) с их chat_id —
чтобы узнать, какой id вписать в data/catalog.json для тестового
поставщика.
"""

import asyncio

from client import get_client, start_client


async def main() -> None:
    client = await start_client(get_client())
    async with client:
        async for dialog in client.iter_dialogs(limit=30):
            kind = "группа" if dialog.is_group else ("канал" if dialog.is_channel else "личный чат")
            print(f"{dialog.id}\t{kind}\t{dialog.name}")


if __name__ == "__main__":
    asyncio.run(main())
