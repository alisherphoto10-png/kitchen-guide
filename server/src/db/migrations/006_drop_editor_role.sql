-- Роль «технолог» (editor) убрана по решению пользователя: полный доступ — «владелец»,
-- владельцев у заведения может быть несколько. Бывшие технологи становятся владельцами,
-- чтобы не потерять право править ТТК.
UPDATE users SET role = 'owner' WHERE role = 'editor';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'viewer'));
