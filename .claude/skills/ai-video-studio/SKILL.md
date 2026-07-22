---
name: ai-video-studio
description: Generate Remotion-based marketing videos for KitchenDesk from a text request, render them to MP4, and save the result into remotion/renders/. Use whenever the user asks for a promo video, product video, teaser, or any Remotion video/animation in this repo.
---

# AI Video Studio — KitchenDesk

Turns a text request into a rendered MP4 marketing video using the Remotion
project already scaffolded at `remotion/` in this repo.

## Brand style — KitchenDesk

- Premium SaaS look
- Dark theme (background `#0b0f0d`)
- Green accents (`#22c55e` / `#15803d`)
- Clean sans-serif type (Arial/Helvetica in the current composition)

## Project layout

```
remotion/
  src/
    Root.tsx          — registers all <Composition> entries
    Composition.tsx    — KitchenDeskPromo composition (landscape, scenes:
                          logo, features, CTA)
    kitchendesk-vertical/ — KitchenDeskVerticalPromo (1080x1920, 60fps, 20s):
                          multi-scene TransitionSeries promo with app-screen
                          mockups (План заготовок / Чек-листы / ТТК /
                          Контроль смены), camera-move-style parallax and
                          fade transitions. Use this as the reference
                          pattern for further "premium vertical promo"
                          requests — reuse its components/ (Background,
                          Logo, ScreenMock, CheckItem) and theme.ts (colors
                          #040816 / #22C55E / #F0F4F8) rather than
                          reinventing them.
    index.css          — Tailwind import (Tailwind v4 is enabled)
  remotion.config.ts   — render config; already points at the sandbox's
                          Chromium build so `remotion render` works offline
  renders/              — rendered MP4s land here (gitignored, kept via .gitkeep)
  package.json          — `npm run dev` (Remotion Studio preview),
                          `npm run render` (renders KitchenDeskPromo to
                          renders/output.mp4), `npm run render:vertical-promo`
                          (renders KitchenDeskVerticalPromo)
```

## Workflow for a text request

1. **Analyze the request** — figure out what the video needs to say (headline,
   features/benefits, call to action) and roughly how long it should run.
2. **Build a storyboard** — a short list of scenes (e.g. logo reveal → feature
   list → CTA), matching the KitchenDesk brand style above.
3. **Create/update the Remotion composition**:
   - For a variation of the existing promo, edit the `defaultKitchenDeskProps`
     in `remotion/src/Composition.tsx` (title, tagline, features, cta) — no
     new composition needed.
   - For a structurally different video, add a new component + a new
     `<Composition id="..." .../>` entry, and register it in
     `remotion/src/Root.tsx` alongside `KitchenDeskPromo`.
   - Keep using `AbsoluteFill`, `Sequence`, `spring`, and `interpolate` for
     animation, consistent with the existing scenes.
4. **Render to MP4** from inside `remotion/`:
   ```bash
   cd remotion
   npx remotion render <CompositionId> renders/<descriptive-name>.mp4
   ```
   (`npm run render` is a shortcut for the default `KitchenDeskPromo` →
   `renders/output.mp4`.) If `node_modules` is missing, run `npm install`
   first.
5. **Save into `remotion/renders/`** — this is already the default output
   directory; do not render anywhere else. These files are gitignored, so
   don't try to commit them — just report the local path back to the user
   (and use `SendUserFile` in Claude Code to actually deliver the video).

## Notes

- This sandbox has no internet access to download Chrome Headless Shell, so
  `remotion.config.ts` pins `Config.setBrowserExecutable(...)` to the
  Playwright Chromium already installed in the environment
  (`/opt/pw-browsers/chromium_headless_shell-1194/...`). Don't remove that.
- If that path doesn't exist in a different environment, fall back to
  `npx remotion render --browser-executable=<path-to-chromium>` or let
  Remotion download its own.
- **Fonts: do not use `@remotion/google-fonts`.** It fetches `.woff2` files
  from `fonts.gstatic.com` inside the headless browser at render time, and
  that fails with `ERR_CERT_AUTHORITY_INVALID` — the sandbox's egress proxy
  re-terminates TLS with its own CA, which the browser's fetch doesn't
  trust. Instead install fonts as system packages (they're picked up by
  Chromium via fontconfig, no network needed at render time), e.g.:
  `apt-get install -y fonts-inter fonts-manrope`, then reference them by
  family name directly in CSS (`fontFamily: "Inter, sans-serif"`). Check
  `apt-cache search fonts-<name>` for availability before assuming a font
  isn't installable.
- **Smooth multi-scene transitions**: use `@remotion/transitions`
  (`TransitionSeries`, `linearTiming`, `fade`/`slide` from
  `@remotion/transitions/fade` etc.) rather than hand-rolled crossfades.
  Remember each `TransitionSeries.Transition` "eats" `durationInFrames`
  frames from the total (it overlaps the end of one scene with the start of
  the next), so if the brief specifies exact per-scene timing, pad each
  scene's authored duration by the transition length so the final visible
  runtime still matches spec — see `KitchenDeskVerticalPromo.tsx` for the
  math (`SCENE_DURATIONS` comment).
- For vertical/cinematic promos: fake camera movement with
  `interpolate`-driven `translateY`/`scale`/`rotateX` (perspective tilt) on
  the content wrapper rather than moving an actual camera — see
  `Scene2Interface.tsx`'s `ScreenSlot` and `Background.tsx`'s slow drift.
