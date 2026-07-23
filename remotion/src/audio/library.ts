import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { probeDurationInSeconds } from "./ffprobe";
import type { AudioAsset } from "./types";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac"]);

const PUBLIC_DIR = path.join(process.cwd(), "public");
const MUSIC_DIR = path.join(PUBLIC_DIR, "music");
const SFX_DIR = path.join(PUBLIC_DIR, "sfx");

const listAudioFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
};

const toAudioAsset = async (dir: string, subfolder: string, fileName: string): Promise<AudioAsset> => {
  const file = path.join(dir, fileName);
  return {
    file,
    relativePath: `${subfolder}/${fileName}`,
    durationInSeconds: await probeDurationInSeconds(file),
    name: path.basename(fileName, path.extname(fileName)),
  };
};

/** Lists every track available in public/music, without loading them. */
export const listBackgroundMusic = (): string[] => listAudioFiles(MUSIC_DIR);

/** Lists every clip available in public/sfx, without loading them. */
export const listSoundEffects = (): string[] => listAudioFiles(SFX_DIR);

/**
 * Auto-connects a background music track for a composition: pass a
 * filename (with or without extension) to pick a specific track from
 * public/music/, or call with no arguments to auto-pick the first track
 * found there (drop an .mp3/.wav into public/music/ and it's picked up
 * automatically — no wiring needed).
 */
export const addBackgroundMusic = async (fileName?: string): Promise<AudioAsset> => {
  const available = listAudioFiles(MUSIC_DIR);

  if (available.length === 0) {
    throw new Error(
      `No music found in public/music/. Drop an .mp3/.wav track there — ` +
        "addBackgroundMusic() auto-connects whatever it finds.",
    );
  }

  const resolved = fileName
    ? (available.find((f) => f === fileName || f.startsWith(`${fileName}.`)) ??
      (() => {
        throw new Error(
          `public/music/${fileName} not found. Available tracks: ${available.join(", ")}`,
        );
      })())
    : available[0];

  return toAudioAsset(MUSIC_DIR, "music", resolved);
};

/**
 * Auto-connects sound effects for a composition: pass specific filenames
 * to pick clips from public/sfx/, or call with no arguments to auto-connect
 * every clip found there.
 */
export const addSoundEffects = async (fileNames?: string[]): Promise<AudioAsset[]> => {
  const available = listAudioFiles(SFX_DIR);

  if (available.length === 0) {
    return [];
  }

  const resolved =
    fileNames && fileNames.length > 0
      ? fileNames.map((name) => {
          const match = available.find((f) => f === name || f.startsWith(`${name}.`));
          if (!match) {
            throw new Error(
              `public/sfx/${name} not found. Available effects: ${available.join(", ")}`,
            );
          }
          return match;
        })
      : available;

  return Promise.all(resolved.map((f) => toAudioAsset(SFX_DIR, "sfx", f)));
};
