import { config as loadDotenv } from "dotenv";
import path from "node:path";
import type { TtsProvider } from "./types";

// Node-side only (generateVoice/renderFinalVideo run as scripts, not inside
// the browser bundle Remotion renders), so it's safe to touch process.env
// and the filesystem here.
loadDotenv({ path: path.join(process.cwd(), ".env") });

export const audioEnv = {
  ttsProvider: (process.env.TTS_PROVIDER as TtsProvider | undefined) ?? "openai",

  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiTtsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE || "onyx",

  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
};

export const isOpenAiConfigured = () => audioEnv.openaiApiKey.length > 0;
export const isElevenLabsConfigured = () =>
  audioEnv.elevenLabsApiKey.length > 0 && audioEnv.elevenLabsVoiceId.length > 0;

export const isProviderConfigured = (provider: TtsProvider) =>
  provider === "openai" ? isOpenAiConfigured() : isElevenLabsConfigured();

export class MissingApiKeyError extends Error {
  constructor(provider: TtsProvider) {
    const envVars =
      provider === "openai"
        ? "OPENAI_API_KEY"
        : "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID";
    super(
      `${provider} TTS is not configured: set ${envVars} in .env (copy .env.example to .env first). ` +
        "No API key was hardcoded anywhere in this project on purpose.",
    );
    this.name = "MissingApiKeyError";
  }
}
