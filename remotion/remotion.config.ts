/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);

// Sandbox has no internet access to download Chrome Headless Shell, so reuse
// the Chromium build that already ships with this environment (Playwright).
const sandboxChromium = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (require("fs").existsSync(sandboxChromium)) {
  Config.setBrowserExecutable(sandboxChromium);
}
