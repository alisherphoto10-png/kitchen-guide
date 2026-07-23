export type TtsProvider = "openai" | "elevenlabs";

export type GenerateVoiceOptions = {
  /** Overrides TTS_PROVIDER from .env for this call. */
  provider?: TtsProvider;
  /** Overrides the provider's default voice from .env for this call. */
  voice?: string;
  /** Filename (without extension) to save under public/voice/. Defaults to a slug derived from the text. */
  name?: string;
  /** Force regeneration even if a file with the same name already exists. */
  overwrite?: boolean;
};

export type VoiceAsset = {
  /** Absolute path on disk, e.g. .../remotion/public/voice/intro.mp3 */
  file: string;
  /** Path relative to public/, for use with Remotion's staticFile(), e.g. "voice/intro.mp3" */
  relativePath: string;
  /** Duration in seconds, probed via ffprobe. */
  durationInSeconds: number;
  provider: TtsProvider;
};

export type AudioAsset = {
  file: string;
  relativePath: string;
  durationInSeconds: number;
  name: string;
};

export type SpeechSegment = {
  /** Start of the spoken line, in seconds from the start of the timeline. */
  startInSeconds: number;
  /** End of the spoken line, in seconds from the start of the timeline. */
  endInSeconds: number;
};

export type MixAudioOptions = {
  /** Music volume while nobody is speaking, 0-1. */
  musicVolume?: number;
  /** Music volume while a speech segment is active, 0-1 (the "ducked" level). */
  duckedMusicVolume?: number;
  /** Fade in/out length for music, in seconds, at the very start/end of the track. */
  musicFadeInSeconds?: number;
  musicFadeOutSeconds?: number;
  /** How long the duck/un-duck transition itself takes, in seconds. */
  duckTransitionSeconds?: number;
};
