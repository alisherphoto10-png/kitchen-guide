import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Probes an audio/video file's duration in seconds using ffprobe. */
export const probeDurationInSeconds = async (file: string): Promise<number> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (Number.isNaN(seconds)) {
    throw new Error(`Could not read duration from ${file} (ffprobe output: "${stdout.trim()}")`);
  }
  return seconds;
};
