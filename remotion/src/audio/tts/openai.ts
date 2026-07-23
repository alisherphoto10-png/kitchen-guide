import { audioEnv, isOpenAiConfigured, MissingApiKeyError } from "../env";

export const synthesizeWithOpenAi = async (
  text: string,
  opts: { voice?: string; model?: string } = {},
): Promise<Buffer> => {
  if (!isOpenAiConfigured()) {
    throw new MissingApiKeyError("openai");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${audioEnv.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? audioEnv.openaiTtsModel,
      voice: opts.voice ?? audioEnv.openaiTtsVoice,
      input: text,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAI TTS request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
