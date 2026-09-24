-- Уведомление о тикете в группе — одно сообщение на тикет, дальше оно редактируется.
-- Запоминаем, где оно: если чат уведомлений сменили, в новом чате появится новое.
ALTER TABLE support_tickets ADD COLUMN notify_chat_id TEXT;
ALTER TABLE support_tickets ADD COLUMN notify_message_id BIGINT;
