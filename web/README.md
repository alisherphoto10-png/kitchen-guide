# KitchenDesk — маркетинговый сайт

Премиальный лендинг KitchenDesk (Next.js App Router + TypeScript + Tailwind v4),
с анимированным маскотом **OVA** (React Three Fiber + Framer Motion) и
кинематографичным скроллом (GSAP ScrollTrigger + Lenis).

Это отдельный проект от боевого фронтенда KitchenDesk (тот живёт на VPS вне
git, `/home/oko-kitchen/oko-kitchen/oko-frontend/`). Разрабатывается здесь
как самостоятельный лендинг и переносится на сервер вручную, когда готов к
деплою.

## Стек

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 (токены дизайна в `src/app/globals.css` через `@theme`)
- Framer Motion — микро-анимации UI (кнопки, карточки, вход элементов)
- GSAP + ScrollTrigger — таймлайны входа, скролл-параллакс
- Lenis — плавный скролл, синхронизирован с GSAP через `gsap.ticker`
- React Three Fiber + drei — амбиентная 3D-сцена вокруг OVA
- CVA + clsx + tailwind-merge — вариативные UI-компоненты

## Запуск

```bash
npm install
npm run dev
```

Откройте http://localhost:3000

```bash
npm run build   # production-сборка
npm run lint    # ESLint
npx tsc --noEmit  # проверка типов
```

## Структура

```
src/
  app/                  — layout.tsx, globals.css (design tokens), page.tsx
  components/
    ui/                 — дизайн-система: Button, Badge, Card, Container,
                          Section, Typography (все на design-токенах)
    layout/              — Navbar, Logo
    providers/           — Lenis + GSAP smooth-scroll provider
    ova/                 — маскот OVA:
                            ova-mascot.tsx     — 2D-спрайт (idle-дыхание,
                                                  моргание, параллакс-наклон
                                                  за курсором, приветствие)
                            ova-3d-scene.tsx   — амбиентная R3F-сцена
                                                  (icosahedron + Sparkles)
                            ova-scene-loader.tsx — ленивая загрузка сцены
                                                    (dynamic, ssr:false)
    sections/
      hero.tsx           — секция Hero с GSAP-таймлайном входа
  lib/
    utils.ts             — cn() (clsx + tailwind-merge)
    gsap.ts              — единая точка регистрации gsap/ScrollTrigger
  assets/ova/             — исходный PNG-рендер OVA (chroma-key вырезан)
```

## OVA

OVA — маскот-робот KitchenDesk из фирменного стикерпака (не сгенерирован
заново — вырезан и обработан из готовых рендеров бренда). Настоящей
rigged 3D-модели для React Three Fiber нет, поэтому:

- сам робот — 2D PNG с прозрачным фоном (chroma-key вручную, см. историю
  разработки), анимируется через Framer Motion (dыхание, моргание глаз-
  экрана через оверлей, наклон от курсора, вход при загрузке);
- 3D — только амбиентная сцена позади робота (стилизованный icosahedron +
  частицы), не сам персонаж.

Если/когда появится rigged GLB-модель OVA, `ova-mascot.tsx` можно заменить
на полноценную R3F-сцену с персонажем без изменений в остальной вёрстке —
компонент уже изолирован и подключается в `hero.tsx` как чёрный ящик.

## Дизайн-токены

Цвета/радиусы/пружины заданы в `src/app/globals.css` (`@theme`) —
не хардкодить hex-значения в компонентах, использовать классы
`bg-bg`, `bg-surface`, `bg-card`, `text-accent`, `rounded-card` и т.д.

Шрифты: **Unbounded** (заголовки) — выбран вместо Space Grotesk из
брендбука, так как у Space Grotesk **нет кириллических глифов**
(проверено через `fontTools`), а весь контент на русском. **Inter**
(текст) — кириллица подтверждена.

## Дальше по плану

Собрана и проверена (build + типы + lint + Playwright-скриншоты
desktop/mobile) только секция **Hero** — по договорённости с заказчиком,
остальные секции (Features, How it works, Testimonials, FAQ, CTA, Footer,
кастомные 404/500/403 с OVA) не входили в этот заход.
