import { existsSync } from "node:fs";

// This sandbox has no internet access to download Chrome Headless Shell, so
// both remotion.config.ts (browser preview/CLI render) and
// renderFinalVideo.ts (programmatic Node render, which does NOT read
// remotion.config.ts) need to point at the Chromium build that already
// ships with this environment via Playwright.
const SANDBOX_CHROMIUM_PATH =
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

export const sandboxChromiumExecutable = existsSync(SANDBOX_CHROMIUM_PATH)
  ? SANDBOX_CHROMIUM_PATH
  : undefined;
