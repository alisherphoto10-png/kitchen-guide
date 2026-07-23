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

## Audio system (voice-over, music, sfx)

Full pipeline lives in `remotion/src/audio/` — see `remotion/.env.example`
for the TTS provider config (copy to `.env`, never commit real keys).

```
remotion/
  .env.example         — TTS_PROVIDER + OPENAI_*/ELEVENLABS_* var names, no keys
  public/
    voice/               — generateVoice() writes TTS output here (gitignored)
    music/               — drop background tracks here; addBackgroundMusic()
                            auto-picks whatever it finds (gitignored)
    sfx/                 — drop effect clips here; addSoundEffects() auto-
                            connects all of them if called with no args (gitignored)
    audio/               — reserved for standalone audio exports/mixdowns (gitignored)
  src/audio/
    env.ts                — loads .env, isOpenAiConfigured()/isElevenLabsConfigured()
    tts/openai.ts          — OpenAI /v1/audio/speech call
    tts/elevenlabs.ts      — ElevenLabs /v1/text-to-speech/{voice} call
    generateVoice.ts        — generateVoice(text, opts?) -> VoiceAsset (Node-only)
    library.ts               — addBackgroundMusic(name?), addSoundEffects(names?),
                                listBackgroundMusic(), listSoundEffects() (Node-only)
    mixAudio.tsx              — <MixAudio voice music sfx options /> — a React
                                component you drop into any composition;
                                ducks music under voice + fades in/out (browser-safe)
    renderFinalVideo.ts       — renderFinalVideo({compositionId, inputProps,
                                outputFileName}) — programmatic bundle+render
                                via @remotion/bundler + @remotion/renderer (Node-only)
  src/audio-demo/AudioPipelineDemo.tsx — minimal composition wired to <MixAudio>,
                                used by the smoke-test script below
  scripts/produce-audio-demo.ts — end-to-end pipeline smoke test (see below)
```

**Node-only vs browser-safe — do not mix them behind one barrel import.**
`generateVoice.ts`, `library.ts`, `renderFinalVideo.ts`, `env.ts` use
`node:fs`/`node:child_process`/`@remotion/bundler` and only ever run in a
Node script (`tsx scripts/...`), never inside a composition. `mixAudio.tsx`
is the only one imported by React components/compositions — it only touches
`remotion`'s own APIs. There is deliberately no shared `src/audio/index.ts`
re-exporting both sides: a composition importing the Node-only modules would
try to pull `node:fs` etc. into the webpack browser bundle Remotion renders.

**Workflow to ship a video with narration:**
1. `generateVoice(text)` (Node script) — picks provider from `TTS_PROVIDER`
   in `.env` (or `opts.provider`), calls OpenAI/ElevenLabs, saves the mp3 to
   `public/voice/<slug>.mp3`, returns `{ relativePath, durationInSeconds }`.
   Caches by filename — reruns without `overwrite: true` reuse the file
   instead of re-hitting the API.
2. `addBackgroundMusic()` / `addSoundEffects()` (Node script) — auto-connect
   whatever's in `public/music/` / `public/sfx/`; pass a filename to pick a
   specific one.
3. Pass the resulting `{relativePath, durationInSeconds, startInSeconds}`
   descriptors as `inputProps` into a composition that renders
   `<MixAudio voice={[...]} music={{...}} sfx={[...]} />`.
4. `renderFinalVideo({ compositionId, inputProps })` — bundles + renders to
   `renders/`. Remotion always mixes every `<Audio>` it finds in the tree
   into the output's audio track automatically — there's no separate
   "attach audio" step.

**Ducking/fade math** lives in `buildMusicVolumeFn` (mixAudio.tsx): music
fades in over `musicFadeInSeconds`, dips to `duckedMusicVolume` under each
voice segment (ramped over `duckTransitionSeconds`), and fades out over
`musicFadeOutSeconds` at the end — all tunable via `MixAudio`'s `options`.

**Gotcha: don't wrap the ducked music `<Audio>` in `<Loop>`.** `<Loop>`
resets the local frame to 0 every cycle, but the volume envelope needs the
*global* frame (voice segments and the fade-out point are absolute timeline
positions) — wrapping in `<Loop>` makes the fade-in silently re-trigger on
every loop restart. `MixAudio` instead repeats the clip manually with one
`<Sequence>` per repeat and reconstructs the global frame inside each
repeat's `volume={(localFrame) => fn(localFrame + repeatStartFrame)}`. Keep
that pattern if you touch this code — verified by rendering
`AudioPipelineDemo` and sampling `ffmpeg -af volumedetect` across the loop
boundary (see below).

**No API key in this sandbox on purpose** (per the task that built this:
don't hardcode credentials). To still prove the pipeline end to end,
`npm run audio:demo` (`scripts/produce-audio-demo.ts`) falls back to short
ffmpeg-generated tones wherever a real asset is missing — a placeholder
narration tone if no TTS key is configured, a placeholder ambient loop if
`public/music/` is empty, a placeholder click if `public/sfx/` is empty —
clearly logged as such, then renders `AudioPipelineDemo` and verifies the
output MP4 has an audio stream via `ffprobe`. Once a real key is in `.env`
and real tracks are in `public/music/`/`public/sfx/`, the exact same
functions produce the real thing.

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
