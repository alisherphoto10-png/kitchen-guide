import { audioEnv, isElevenLabsConfigured, MissingApiKeyError } from "../env";

export const synthesizeWithElevenLabs = async (
  text: string,
  opts: { voiceId?: string; model?: string } = {},
): Promise<Buffer> => {
  if (!isElevenLabsConfigured()) {
    throw new MissingApiKeyError("elevenlabs");
  }

  const voiceId = opts.voiceId ?? audioEnv.elevenLabsVoiceId;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": audioEnv.elevenLabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: opts.model ?? audioEnv.elevenLabsModel,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
