/**
 * End-to-end smoke test for the audio pipeline: generateVoice ->
 * addBackgroundMusic -> addSoundEffects -> MixAudio -> renderFinalVideo.
 *
 * No API key is configured in this environment on purpose (see
 * .env.example), so this script falls back to short ffmpeg-generated tones
 * in place of real narration/music wherever a step can't run for real —
 * clearly logged as such. That's enough to prove the wiring (ducking,
 * fades, sequencing, final MP4 audio track) end to end; swap in a real
 * OPENAI_API_KEY/ELEVENLABS_API_KEY and drop real tracks into
 * public/music/ + public/sfx/ to get the real thing with the exact same
 * commands.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateVoice } from "../src/audio/generateVoice";
import { addBackgroundMusic, addSoundEffects } from "../src/audio/library";
import { renderFinalVideo } from "../src/audio/renderFinalVideo";
import { audioEnv, isProviderConfigured } from "../src/audio/env";
import { probeDurationInSeconds } from "../src/audio/ffprobe";
import type { AudioAsset, VoiceAsset } from "../src/audio/types";

const NARRATION_LINE = "KitchenDesk убирает бумажный хаос с вашей кухни.";
const PROJECT_ROOT = process.cwd();

const ensureTone = (dir: string, fileName: string, filterArgs: string[]): string => {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  if (!existsSync(file)) {
    execFileSync("ffmpeg", ["-y", ...filterArgs, file], { stdio: "inherit" });
  }
  return file;
};

const getVoice = async (): Promise<VoiceAsset> => {
  if (isProviderConfigured(audioEnv.ttsProvider)) {
    return generateVoice(NARRATION_LINE);
  }

  console.warn(
    `[audio-demo] No ${audioEnv.ttsProvider} API key in .env — using a placeholder tone instead of ` +
      "real narration. Copy .env.example to .env and add a key to hear real TTS.",
  );
  const dir = path.join(PROJECT_ROOT, "public", "voice");
  const file = ensureTone(dir, "placeholder-narration.mp3", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-af",
    "volume=0.4",
  ]);
  return {
    file,
    relativePath: "voice/placeholder-narration.mp3",
    durationInSeconds: await probeDurationInSeconds(file),
    provider: audioEnv.ttsProvider,
  };
};

const getMusic = async (): Promise<AudioAsset> => {
  try {
    return await addBackgroundMusic();
  } catch {
    console.warn(
      "[audio-demo] No tracks in public/music/ — generating a placeholder ambient loop to verify mixing.",
    );
    const dir = path.join(PROJECT_ROOT, "public", "music");
    ensureTone(dir, "placeholder-ambient.mp3", [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=8",
      "-af",
      "volume=0.5",
    ]);
    return addBackgroundMusic("placeholder-ambient.mp3");
  }
};

const getSfx = async (): Promise<AudioAsset[]> => {
  const found = await addSoundEffects();
  if (found.length > 0) return found;

  console.warn("[audio-demo] No clips in public/sfx/ — generating a placeholder click to verify sfx wiring.");
  const dir = path.join(PROJECT_ROOT, "public", "sfx");
  ensureTone(dir, "placeholder-click.mp3", ["-f", "lavfi", "-i", "sine=frequency=880:duration=0.2"]);
  return addSoundEffects(["placeholder-click.mp3"]);
};

const verifyAudioTrack = (file: string): void => {
  const streams = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name",
    "-of",
    "default=noprint_wrappers=1",
    file,
  ]).toString();

  if (!streams.includes("codec_type=audio")) {
    throw new Error(`Rendered file ${file} has no audio stream — audio pipeline is not wired correctly.`);
  }
  console.log(`[audio-demo] Verified audio track present in ${file}:\n${streams}`);
};

const main = async () => {
  const voice = await getVoice();
  const music = await getMusic();
  const sfx = await getSfx();

  console.log("[audio-demo] voice:", voice);
  console.log("[audio-demo] music:", music);
  console.log("[audio-demo] sfx:", sfx);

  const result = await renderFinalVideo({
    compositionId: "AudioPipelineDemo",
    outputFileName: "audio-pipeline-demo.mp4",
    inputProps: {
      voice: [
        {
          relativePath: voice.relativePath,
          startInSeconds: 1,
          durationInSeconds: voice.durationInSeconds,
        },
      ],
      music: {
        relativePath: music.relativePath,
        durationInSeconds: music.durationInSeconds,
      },
      sfx: sfx.map((clip, i) => ({
        relativePath: clip.relativePath,
        startInSeconds: 0.2 + i * 0.6,
      })),
    },
  });

  console.log(`[audio-demo] Rendered ${result.outputLocation} (${result.durationInSeconds.toFixed(2)}s)`);
  verifyAudioTrack(result.outputLocation);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
