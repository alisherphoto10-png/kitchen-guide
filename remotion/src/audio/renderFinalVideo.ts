import { mkdirSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { sandboxChromiumExecutable } from "../sandboxChromium";
import { probeDurationInSeconds } from "./ffprobe";

export type RenderFinalVideoOptions = {
  /** id of the <Composition> to render, as registered in src/Root.tsx */
  compositionId: string;
  /** Props passed into the composition (voice/music/sfx descriptors, script text, etc). */
  inputProps?: Record<string, unknown>;
  /** Output filename under renders/. Defaults to `${compositionId}.mp4`. */
  outputFileName?: string;
};

export type RenderFinalVideoResult = {
  outputLocation: string;
  durationInSeconds: number;
};

/**
 * Bundles and renders a composition to an MP4 in renders/, exactly like
 * `npx remotion render`, but callable from a script — used as the last
 * step of the audio pipeline. Remotion always mixes every <Audio> it finds
 * in the composition tree (voice, music, sfx from mixAudio()/MixAudio)
 * into the output's audio track automatically; there is no separate
 * "attach audio" step to configure.
 */
export const renderFinalVideo = async ({
  compositionId,
  inputProps = {},
  outputFileName,
}: RenderFinalVideoOptions): Promise<RenderFinalVideoResult> => {
  const projectRoot = process.cwd();
  const entryPoint = path.join(projectRoot, "src", "index.ts");

  const bundleLocation = await bundle({
    entryPoint,
    webpackOverride: (webpackConfig) => webpackConfig,
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps,
    browserExecutable: sandboxChromiumExecutable,
  });

  const outputLocation = path.join(
    projectRoot,
    "renders",
    outputFileName ?? `${compositionId}.mp4`,
  );
  mkdirSync(path.dirname(outputLocation), { recursive: true });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation,
    inputProps,
    browserExecutable: sandboxChromiumExecutable,
    overwrite: true,
  });

  return {
    outputLocation,
    durationInSeconds: await probeDurationInSeconds(outputLocation),
  };
};
