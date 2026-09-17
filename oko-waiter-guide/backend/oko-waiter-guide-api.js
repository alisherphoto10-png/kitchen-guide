const express = require("express");
const fs = require("fs");
const path = require("path");
const store = require("./oko-waiter-guide-store");
const { parseWaiterGuideMarkdown } = require("./oko-waiter-guide-md-import");
const { buildDishesWorkbook, parseDishesWorkbook } = require("./oko-waiter-guide-xlsx");

// "🔥 Хит" -> { emoji: "🔥", label: "Хит" } — для восстановления статуса,
// заведённого руками в ячейке Excel без явного эмодзи-поля.
function splitEmojiLabel(text) {
  const trimmed = String(text || "").trim();
  const m = /^(\p{Extended_Pictographic}️?)\s*(.*)$/u.exec(trimmed);
  if (m && m[2]) return { emoji: m[1], label: m[2] };
  return { emoji: "", label: trimmed };
}

// Владелец — единый пароль из .env, логин НЕ вводит (пустое поле логина на
// экране входа = "это я"). Именованные сотрудники (data/users.json) входят
// логином+паролем, их роль (kitchen/bar/both) даёт req.allowedGroups.
// Общий пароль бара (OKO_BAR_PASSWORD, выдан раньше сегодняшним доступом)
// оставлен как запасной вариант — ничего не ломаем из уже выданного.
function authenticate(req, res, next) {
  const password = req.header("X-Admin-Password");
  const login = (req.header("X-Admin-Login") || "").trim();

  if (!login && process.env.OKO_ADMIN_PASSWORD && password === process.env.OKO_ADMIN_PASSWORD) {
    req.scope = "all";
    req.userId = null;
    req.userName = "Владелец";
    return next();
  }
  if (login) {
    const user = store.verifyUserPassword(login, password);
    if (user) {
      req.scope = "user";
      req.allowedGroups = user.role === "both" ? ["kitchen", "bar"] : [user.role];
      req.userId = user.id;
      req.userName = user.name;
      return next();
    }
  }
  if (!login && process.env.OKO_BAR_PASSWORD && password === process.env.OKO_BAR_PASSWORD) {
    req.scope = "user";
    req.allowedGroups = ["bar"];
    req.userId = null;
    req.userName = "Бар (общий доступ)";
    return next();
  }
  return res.status(401).json({ error: "Неверный логин или пароль" });
}

function requireOwner(req, res, next) {
  if (req.scope !== "all") return res.status(403).json({ error: "Доступно только владельцу" });
  next();
}

// scope "all" (владелец) может всё; иначе — только внутри groups, входящих
// в req.allowedGroups. Раздел "без раздела" (null/не найден) сотруднику
// никогда не разрешён.
function sectionAllowed(sectionId, req) {
  if (req.scope === "all") return true;
  if (!sectionId) return false;
  const section = store.readSections().find((s) => s.id === sectionId);
  if (!section) return false;
  return (req.allowedGroups || []).includes(store.sectionGroup(section));
}

// Экранирование для Telegram legacy Markdown — сообщение официанта идёт с
// подписями в *bold*, а сам текст пользователя может случайно содержать
// _ * ` [ и сломать парсинг (Telegram вернёт 400). Бэкслеш перед спецсимволом
// делает его буквальным и не отображается в итоговом сообщении.
function escapeMd(value) {
  return String(value).replace(/([_*`[])/g, "\\$1");
}

function createOkoWaiterGuideRouter(bot) {
  const router = express.Router();

  // ---------- public — the read-only page waiters open, no password ----------
  // (same posture as oko-order-relay's order form: not a secret, just an
  // unlisted link — this is reference material, not sensitive data).
  router.get("/guide", (req, res) => {
    res.json(store.getGuide());
  });

  // Отзыв/ошибка от официанта или управляющего — уходит владельцу в Telegram
  // (тот же чат, что и остальные admin/owner-уведомления в системе), плюс
  // всегда пишется в файл на диске как страховка от сбоя отправки.
  router.post("/feedback", async (req, res) => {
    const { message, dishName, name } = req.body || {};
    const text = String(message || "").trim();
    const senderName = String(name || "").trim().slice(0, 100);
    if (!text) return res.status(400).json({ error: "Напишите сообщение" });
    if (!senderName) return res.status(400).json({ error: "Укажите имя" });
    if (text.length > 2000) return res.status(400).json({ error: "Слишком длинное сообщение" });
    const cleanDishName = String(dishName || "").trim().slice(0, 200);

    try {
      store.addFeedback({ message: text, dishName: cleanDishName, name: senderName });
    } catch (e) {
      console.error("[oko-waiter-guide] feedback log failed:", e.message);
    }

    const divider = "━━━━━━━━━━━━━━";
    const lines = ["📝 *Новый отзыв* — пособие OKO", divider, `👤 *От:* ${escapeMd(senderName)}`];
    if (cleanDishName) lines.push(`🍽 *Блюдо:* ${escapeMd(cleanDishName)}`);
    lines.push(divider, escapeMd(text));
    try {
      if (bot && process.env.SUPER_ADMIN_TG_ID) {
        await bot.sendMessage(process.env.SUPER_ADMIN_TG_ID, lines.join("\n"), { parse_mode: "Markdown" });
      }
    } catch (e) {
      console.error("[oko-waiter-guide] feedback telegram send failed:", e.message);
    }

    res.json({ ok: true });
  });

  router.get("/photos/:filename", (req, res) => {
    const filePath = store.photoPath(req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  });

  // Статусы (🔥 Хит и т.п.) — просто подписи и эмодзи, не персональные/
  // финансовые данные, поэтому отдаём без пароля тем же принципом, что и
  // /guide — странице официанта нужно знать, как подписать бейдж.
  router.get("/statuses", (req, res) => {
    res.json(store.readStatuses());
  });

  // ---------- admin — editing, password-gated ----------
  const admin = express.Router();
  admin.use(authenticate);

  admin.get("/whoami", (req, res) => {
    res.json({ scope: req.scope, name: req.userName, allowedGroups: req.allowedGroups || null });
  });

  admin.get("/sections", (req, res) => {
    const all = store.getSectionsShaped();
    res.json(req.scope === "all" ? all : all.filter((s) => (req.allowedGroups || []).includes(store.sectionGroup(s))));
  });
  admin.post("/sections", (req, res) => {
    const { name, icon, group, parentId, note } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название раздела" });
    if (parentId && !sectionAllowed(parentId, req)) return res.status(403).json({ error: "Нет доступа к этому разделу" });
    // Сотрудник с ОДНОЙ ролью (kitchen ИЛИ bar) не может создать себе раздел
    // в другой зоне — группа навязывается. С ролью "both" (или владелец) —
    // можно выбрать, он и так видит обе зоны.
    const effectiveGroup = req.scope === "all" || (req.allowedGroups || []).length > 1
      ? group
      : (req.allowedGroups || [])[0];
    const section = store.addSection({ name, icon, group: effectiveGroup, parentId, note });
    store.logActivity({ userId: req.userId, userName: req.userName, action: "section_created", targetName: section.name });
    res.json(section);
  });
  admin.patch("/sections/:id", async (req, res) => {
    const existing = store.readSections().find((s) => s.id === req.params.id);
    if (!existing || !sectionAllowed(existing.id, req)) return res.status(404).json({ error: "Раздел не найден" });
    const patch = Object.assign({}, req.body || {});
    // Сотрудник с ОДНОЙ ролью не может перевесить раздел в другую зону;
    // с "both" (или владелец) — может.
    if (req.scope !== "all" && (req.allowedGroups || []).length <= 1) delete patch.group;
    const section = await store.updateSection(req.params.id, patch);
    store.logActivity({ userId: req.userId, userName: req.userName, action: "section_updated", targetName: section.name });
    res.json(section);
  });
  admin.delete("/sections/:id", (req, res) => {
    const existing = store.readSections().find((s) => s.id === req.params.id);
    if (!existing || !sectionAllowed(existing.id, req)) return res.status(404).json({ error: "Раздел не найден" });
    store.deleteSection(req.params.id);
    store.logActivity({ userId: req.userId, userName: req.userName, action: "section_deleted", targetName: existing.name });
    res.json({ ok: true });
  });
  admin.post("/sections/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "Нужен orderedIds" });
    if (req.scope !== "all" && orderedIds.some((id) => !sectionAllowed(id, req))) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    store.reorderSections(orderedIds);
    res.json({ ok: true });
  });

  admin.get("/dishes", (req, res) => {
    const all = store.getAllDishesShaped();
    res.json(req.scope === "all" ? all : all.filter((d) => sectionAllowed(d.sectionId, req)));
  });
  admin.post("/dishes", (req, res) => {
    const { name, sectionId } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите название блюда" });
    if (!sectionAllowed(sectionId, req)) return res.status(403).json({ error: "Нет доступа к этому разделу" });
    const dish = store.addDish(req.body || {});
    const section = store.readSections().find((s) => s.id === sectionId);
    store.logActivity({ userId: req.userId, userName: req.userName, action: "dish_created", targetName: dish.name, sectionName: section && section.name });
    res.json(dish);
  });
  admin.patch("/dishes/:id", (req, res) => {
    const existing = store.readDishes().find((d) => d.id === req.params.id);
    if (!existing || !sectionAllowed(existing.sectionId, req)) return res.status(404).json({ error: "Блюдо не найдено" });
    const patch = req.body || {};
    if (patch.sectionId !== undefined && !sectionAllowed(patch.sectionId, req)) {
      return res.status(403).json({ error: "Нет доступа к этому разделу" });
    }
    const dish = store.updateDish(req.params.id, patch);
    const section = store.readSections().find((s) => s.id === dish.sectionId);
    store.logActivity({ userId: req.userId, userName: req.userName, action: "dish_updated", targetName: dish.name, sectionName: section && section.name });
    res.json(dish);
  });
  admin.delete("/dishes/:id", (req, res) => {
    const existing = store.readDishes().find((d) => d.id === req.params.id);
    if (!existing || !sectionAllowed(existing.sectionId, req)) return res.status(404).json({ error: "Блюдо не найдено" });
    store.deleteDish(req.params.id);
    const section = store.readSections().find((s) => s.id === existing.sectionId);
    store.logActivity({ userId: req.userId, userName: req.userName, action: "dish_deleted", targetName: existing.name, sectionName: section && section.name });
    res.json({ ok: true });
  });
  admin.post("/dishes/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "Нужен orderedIds" });
    if (req.scope !== "all") {
      const dishes = store.readDishes();
      const allowed = orderedIds.every((id) => {
        const d = dishes.find((x) => x.id === id);
        return d && sectionAllowed(d.sectionId, req);
      });
      if (!allowed) return res.status(403).json({ error: "Нет доступа" });
    }
    store.reorderDishes(orderedIds);
    res.json({ ok: true });
  });

  admin.get("/orphan-dishes", (req, res) => {
    // "Без раздела" — блюда с потерянной/удалённой принадлежностью; для
    // бар-доступа принадлежность неоднозначна (могли быть и кухонными), так
    // что безопаснее не показывать вовсе, чем случайно раскрыть.
    res.json(req.scope === "all" ? store.getOrphanDishes() : []);
  });

  // ---------- статусы блюд (🔥 Хит и т.п.) — доступно любому авторизованному
  // сотруднику, как разделы/блюда; не персональные/финансовые данные ----------
  admin.get("/statuses", (req, res) => {
    res.json(store.readStatuses());
  });
  admin.post("/statuses", (req, res) => {
    const { emoji, label } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: "Укажите название статуса" });
    const status = store.addStatus({ emoji, label });
    store.logActivity({ userId: req.userId, userName: req.userName, action: "status_created", targetName: status.label });
    res.json(status);
  });
  admin.patch("/statuses/:id", (req, res) => {
    const status = store.updateStatus(req.params.id, req.body || {});
    if (!status) return res.status(404).json({ error: "Статус не найден" });
    store.logActivity({ userId: req.userId, userName: req.userName, action: "status_updated", targetName: status.label });
    res.json(status);
  });
  admin.delete("/statuses/:id", (req, res) => {
    const existing = store.readStatuses().find((s) => s.id === req.params.id);
    const ok = store.deleteStatus(req.params.id);
    if (!ok) return res.status(404).json({ error: "Статус не найден" });
    if (existing) store.logActivity({ userId: req.userId, userName: req.userName, action: "status_deleted", targetName: existing.label });
    res.json({ ok: true });
  });
  admin.post("/statuses/reorder", (req, res) => {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "Нужен orderedIds" });
    store.reorderStatuses(orderedIds);
    res.json({ ok: true });
  });

  // ---------- users & activity (только владелец) ----------
  admin.get("/users", requireOwner, (req, res) => {
    res.json(store.readUsers().map(store.shapeUser));
  });
  admin.post("/users", requireOwner, (req, res) => {
    const { name, login, password, role } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Укажите имя" });
    if (!login || !login.trim()) return res.status(400).json({ error: "Укажите логин" });
    if (!password || String(password).length < 4) return res.status(400).json({ error: "Пароль слишком короткий" });
    try {
      const user = store.addUser({ name, login, password, role });
      store.logActivity({ userId: req.userId, userName: req.userName, action: "user_created", targetName: user.name });
      res.json(user);
    } catch (e) {
      if (e.code === "LOGIN_TAKEN") return res.status(409).json({ error: "Логин уже занят" });
      throw e;
    }
  });
  admin.patch("/users/:id", requireOwner, (req, res) => {
    try {
      const user = store.updateUser(req.params.id, req.body || {});
      if (!user) return res.status(404).json({ error: "Пользователь не найден" });
      if (req.body && (req.body.name !== undefined || req.body.login !== undefined || req.body.role !== undefined)) {
        store.logActivity({ userId: req.userId, userName: req.userName, action: "user_updated", targetName: user.name });
      }
      res.json(user);
    } catch (e) {
      if (e.code === "LOGIN_TAKEN") return res.status(409).json({ error: "Логин уже занят" });
      throw e;
    }
  });
  admin.delete("/users/:id", requireOwner, (req, res) => {
    const target = store.readUsers().find((u) => u.id === req.params.id);
    const ok = store.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "Пользователь не найден" });
    if (target) store.logActivity({ userId: req.userId, userName: req.userName, action: "user_deleted", targetName: target.name });
    res.json({ ok: true });
  });

  admin.get("/activity", requireOwner, (req, res) => {
    res.json(store.getActivity(200));
  });

  // ---------- фирменные изображения (только владелец) ----------
  // Перезаписывают статические файлы прямо во frontend — слайдшоу на
  // главной и логотип захардкожены на эти имена файлов, поэтому фронтенду
  // ничего менять не нужно, просто новые байты на том же пути.
  admin.post("/settings/logo", requireOwner, async (req, res) => {
    const buf = await store.processImageBuffer((req.body || {}).image, { maxDim: 900, quality: 90, flattenBlack: true });
    if (!buf) return res.status(400).json({ error: "Некорректное изображение" });
    store.saveStaticImage(buf, path.join(store.FRONTEND_DIR, "logo.jpg"));
    res.json({ ok: true });
  });
  admin.post("/settings/hero/:slot", requireOwner, async (req, res) => {
    const slot = req.params.slot;
    if (!["1", "2", "3"].includes(slot)) return res.status(400).json({ error: "Некорректный слот" });
    const buf = await store.processImageBuffer((req.body || {}).image, { maxDim: 1800, quality: 82 });
    if (!buf) return res.status(400).json({ error: "Некорректное изображение" });
    store.saveStaticImage(buf, path.join(store.FRONTEND_DIR, "hero", `hero-${slot}.jpg`));
    res.json({ ok: true });
  });

  // Массовый импорт блюд из .md-файла — формат см. в
  // oko-waiter-guide-md-import.js. sectionId в теле запроса — раздел,
  // выбранный вручную в форме загрузки; если не передан, используется
  // раздел, указанный в самом файле (создаётся, если такого раздела ещё
  // нет). Фото не переносятся — их добавляют потом вручную по блюду.
  admin.post("/import-markdown", (req, res) => {
    // Массовый импорт может по ходу файла создавать НОВЫЕ разделы
    // (d.sectionOverride) — корректно тегировать их все под "bar" для
    // ограниченного доступа того стоит, но это нишевый инструмент
    // (разовая загрузка меню), которым бар едва ли будет пользоваться —
    // проще временно не пускать сюда бар-доступ вовсе, чем плодить риск
    // дыры в разделении кухня/бар.
    if (req.scope !== "all") return res.status(403).json({ error: "Импорт доступен только владельцу" });
    const { markdown, sectionId } = req.body || {};
    if (!markdown || !markdown.trim()) {
      return res.status(400).json({ error: "Файл пустой" });
    }

    const parsed = parseWaiterGuideMarkdown(markdown);
    if (!parsed.dishes.length) {
      return res.status(400).json({ error: "Не нашли ни одного блюда в файле — проверьте формат" });
    }

    let targetSectionId = sectionId || null;
    let targetSectionName = null;
    if (!targetSectionId) {
      const name = parsed.defaultSection;
      if (!name) {
        return res.status(400).json({
          error: "В файле нет строки \"Раздел везде один: **Название**\" — выберите раздел вручную",
        });
      }
      const existing = store.readSections().find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
      const section = existing || store.addSection({ name });
      targetSectionId = section.id;
      targetSectionName = section.name;
    } else {
      const section = store.readSections().find((s) => s.id === targetSectionId);
      if (!section) return res.status(400).json({ error: "Раздел не найден" });
      targetSectionName = section.name;
    }

    const created = parsed.dishes.map((d) =>
      store.addDish({
        sectionId: d.sectionOverride
          ? (store.readSections().find((s) => s.name.trim().toLowerCase() === d.sectionOverride.toLowerCase()) ||
              store.addSection({ name: d.sectionOverride })).id
          : targetSectionId,
        name: d.name,
        subtitle: d.subtitle,
        description: d.description,
        history: d.history,
        howToServe: d.howToServe,
        calcTables: d.calcTables,
      }),
    );

    res.json({
      ok: true,
      sectionId: targetSectionId,
      sectionName: targetSectionName,
      created: created.length,
      dishNames: created.map((d) => d.name),
      skipped: parsed.skipped,
    });
  });

  // ---------- экспорт/импорт блюд через Excel ----------
  // Формат — см. oko-waiter-guide-xlsx.js (лист "ттк", одна строка на
  // ингредиент, поля блюда — объединённая ячейка на блок). Только владелец:
  // импорт может создавать разделы/подразделы/статусы по всей системе разом,
  // это не тот инструмент, который стоит доверять ограниченному бар-доступу.
  admin.get("/export-xlsx", requireOwner, async (req, res) => {
    const guideAll = store.getGuideAll();
    const statuses = store.readStatuses();
    const orphans = store.getOrphanDishes();
    const wb = buildDishesWorkbook(guideAll, statuses, orphans);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="oko-blyuda-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  admin.post("/import-xlsx", requireOwner, async (req, res) => {
    const { fileBase64 } = req.body || {};
    if (!fileBase64) return res.status(400).json({ error: "Файл не передан" });
    const match = /^data:.*;base64,(.+)$/.exec(fileBase64);
    const buffer = Buffer.from(match ? match[1] : fileBase64, "base64");

    let parsed;
    try {
      parsed = await parseDishesWorkbook(buffer);
    } catch (e) {
      return res.status(400).json({ error: "Не удалось прочитать файл — это точно .xlsx?" });
    }
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!parsed.dishes.length) return res.status(400).json({ error: "Не нашли ни одного блюда в файле" });

    // Разделы/подразделы/статусы — находим по названию или заводим на лету
    // (та же удобная логика, что и у импорта .md), с кэшем на время одного
    // импорта, чтобы не заводить дубль при повторении названия в разных строках.
    const sectionCache = new Map();
    function resolveSection(name, parentId) {
      const key = `${parentId || ""}::${name.trim().toLowerCase()}`;
      if (sectionCache.has(key)) return sectionCache.get(key);
      const found = store.readSections().find(
        (s) => (s.parentId || null) === (parentId || null) && s.name.trim().toLowerCase() === name.trim().toLowerCase(),
      ) || store.addSection({ name, parentId });
      sectionCache.set(key, found);
      return found;
    }
    const statusCache = new Map();
    function resolveStatus(label) {
      const key = label.trim().toLowerCase();
      if (statusCache.has(key)) return statusCache.get(key);
      const existing = store.readStatuses().find((s) => {
        const combined = [s.emoji, s.label].filter(Boolean).join(" ").trim().toLowerCase();
        return combined === key || s.label.trim().toLowerCase() === key;
      });
      const status = existing || store.addStatus(splitEmojiLabel(label));
      statusCache.set(key, status);
      return status;
    }

    const existingDishes = store.readDishes();
    const result = { created: 0, updated: 0, createdNames: [], updatedNames: [], warnings: [], skippedSheets: parsed.skippedSheets };

    for (const d of parsed.dishes) {
      const patch = {
        name: d.name,
        subtitle: d.subtitle,
        description: d.description,
        history: d.history,
        waiterPhrase: d.waiterPhrase,
        historyQuote: d.historyQuote,
        servingSteps: d.servingSteps,
        allergens: d.allergens,
        features: d.features,
        recommendations: d.recommendations,
        warning: d.warning,
        faq: d.faq,
        hidden: d.hidden,
        status: d.statusLabel ? resolveStatus(d.statusLabel).id : "",
      };
      // Пустой "раздел" НЕ переносит блюдо в "Без раздела" — слишком легко
      // случайно стереть эту ячейку, редактируя что-то рядом. То же с
      // составом: пусто в файле — состав не трогаем (см. hasCalcRows).
      if (d.sectionName) {
        const top = resolveSection(d.sectionName, null);
        const target = d.subsectionName ? resolveSection(d.subsectionName, top.id) : top;
        patch.sectionId = target.id;
      }
      if (d.hasCalcRows) patch.calcTables = d.calcTables;

      const existing = d.id ? existingDishes.find((x) => x.id === d.id) : null;
      if (existing) {
        store.updateDish(d.id, patch);
        result.updated++;
        result.updatedNames.push(d.name);
      } else {
        if (d.id) result.warnings.push(`«${d.name}»: id «${d.id}» не найден — создано как новое блюдо`);
        store.addDish(patch);
        result.created++;
        result.createdNames.push(d.name);
      }
    }

    store.logActivity({
      userId: req.userId,
      userName: req.userName,
      action: "dishes_imported",
      targetName: `создано ${result.created}, обновлено ${result.updated}`,
    });
    res.json({ ok: true, ...result });
  });

  router.use("/admin", admin);

  return router;
}

module.exports = { createOkoWaiterGuideRouter };
