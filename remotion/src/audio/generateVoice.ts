import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { audioEnv } from "./env";
import { synthesizeWithOpenAi } from "./tts/openai";
import { synthesizeWithElevenLabs } from "./tts/elevenlabs";
import { probeDurationInSeconds } from "./ffprobe";
import type { GenerateVoiceOptions, VoiceAsset } from "./types";

const VOICE_DIR = path.join(process.cwd(), "public", "voice");

const slugify = (text: string): string => {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // Short hash of the full text so two lines that slugify the same way
  // (or get truncated identically) don't silently overwrite each other.
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `${base || "voice"}-${hash.toString(36)}`;
};

/**
 * Generates a voice-over line via OpenAI TTS or ElevenLabs (picked from
 * TTS_PROVIDER in .env, or opts.provider), saves it under public/voice/,
 * and returns everything a Remotion composition needs to play it
 * (relativePath for staticFile(), and its duration for sequencing).
 *
 * Caches by content: calling this again with the same text + name reuses
 * the file on disk instead of re-hitting the API, unless opts.overwrite.
 */
export const generateVoice = async (
  text: string,
  opts: GenerateVoiceOptions = {},
): Promise<VoiceAsset> => {
  if (!text.trim()) {
    throw new Error("generateVoice: text must not be empty");
  }

  const provider = opts.provider ?? audioEnv.ttsProvider;
  const name = opts.name ?? slugify(text);
  const fileName = `${name}.mp3`;
  const file = path.join(VOICE_DIR, fileName);

  mkdirSync(VOICE_DIR, { recursive: true });

  if (existsSync(file) && !opts.overwrite) {
    return {
      file,
      relativePath: `voice/${fileName}`,
      durationInSeconds: await probeDurationInSeconds(file),
      provider,
    };
  }

  const audioBuffer =
    provider === "openai"
      ? await synthesizeWithOpenAi(text, { voice: opts.voice })
      : await synthesizeWithElevenLabs(text, { voiceId: opts.voice });

  writeFileSync(file, audioBuffer);

  return {
    file,
    relativePath: `voice/${fileName}`,
    durationInSeconds: await probeDurationInSeconds(file),
    provider,
  };
};
