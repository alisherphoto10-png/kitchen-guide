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
    Composition.tsx    — KitchenDeskPromo composition (scenes: logo, features, CTA)
    index.css          — Tailwind import (Tailwind v4 is enabled)
  remotion.config.ts   — render config; already points at the sandbox's
                          Chromium build so `remotion render` works offline
  renders/              — rendered MP4s land here (gitignored, kept via .gitkeep)
  package.json          — `npm run dev` (Remotion Studio preview),
                          `npm run render` (renders KitchenDeskPromo to
                          renders/output.mp4)
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
