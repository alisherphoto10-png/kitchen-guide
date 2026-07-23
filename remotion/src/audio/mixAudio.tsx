import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import type { MixAudioOptions, SpeechSegment } from "./types";

export type VoiceTrack = {
  relativePath: string;
  startInSeconds: number;
  durationInSeconds: number;
  volume?: number;
};

export type MusicTrack = {
  relativePath: string;
  durationInSeconds: number;
  startInSeconds?: number;
};

export type SfxTrack = {
  relativePath: string;
  startInSeconds: number;
  volume?: number;
};

const DEFAULT_OPTIONS: Required<MixAudioOptions> = {
  musicVolume: 0.35,
  duckedMusicVolume: 0.12,
  musicFadeInSeconds: 1,
  musicFadeOutSeconds: 1.5,
  duckTransitionSeconds: 0.4,
};

/**
 * Builds the per-frame volume callback for the music track: fades in/out at
 * the edges of the whole timeline, and automatically dips ("ducks") under
 * every voice segment so narration always reads clearly over the music,
 * ramping back up smoothly once each line ends.
 */
export const buildMusicVolumeFn = (
  voiceSegments: SpeechSegment[],
  totalDurationInSeconds: number,
  fps: number,
  options: MixAudioOptions = {},
) => {
  const { musicVolume, duckedMusicVolume, musicFadeInSeconds, musicFadeOutSeconds, duckTransitionSeconds } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  return (frame: number): number => {
    const t = frame / fps;

    let base = musicVolume;
    if (t < musicFadeInSeconds) {
      base = interpolate(t, [0, musicFadeInSeconds], [0, musicVolume], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    } else if (t > totalDurationInSeconds - musicFadeOutSeconds) {
      base = interpolate(
        t,
        [totalDurationInSeconds - musicFadeOutSeconds, totalDurationInSeconds],
        [musicVolume, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
    }

    let duckFactor = 0;
    for (const seg of voiceSegments) {
      const rampInStart = seg.startInSeconds - duckTransitionSeconds;
      const rampOutEnd = seg.endInSeconds + duckTransitionSeconds;
      if (t < rampInStart || t > rampOutEnd) continue;

      if (t < seg.startInSeconds) {
        duckFactor = Math.max(
          duckFactor,
          interpolate(t, [rampInStart, seg.startInSeconds], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        );
      } else if (t > seg.endInSeconds) {
        duckFactor = Math.max(
          duckFactor,
          interpolate(t, [seg.endInSeconds, rampOutEnd], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        );
      } else {
        duckFactor = 1;
      }
    }

    return interpolate(duckFactor, [0, 1], [base, Math.min(base, duckedMusicVolume)], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  };
};

export type MixAudioProps = {
  voice?: VoiceTrack[];
  music?: MusicTrack;
  sfx?: SfxTrack[];
  options?: MixAudioOptions;
};

/**
 * Drop this once in a composition to get voice + music + sfx mixed
 * automatically: music plays under everything, ducks under each voice
 * line, and fades in/out at the ends — Remotion bakes the mixed result
 * into the rendered MP4's audio track, no separate mixdown step needed.
 */
export const MixAudio: React.FC<MixAudioProps> = ({ voice = [], music, sfx = [], options }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const totalDurationInSeconds = durationInFrames / fps;

  const voiceSegments: SpeechSegment[] = voice.map((v) => ({
    startInSeconds: v.startInSeconds,
    endInSeconds: v.startInSeconds + v.durationInSeconds,
  }));

  const musicVolumeFn = music
    ? buildMusicVolumeFn(voiceSegments, totalDurationInSeconds, fps, options)
    : undefined;

  return (
    <>
      {music &&
        (() => {
          const musicStartFrame = Math.round((music.startInSeconds ?? 0) * fps);
          const musicClipFrames = Math.max(1, Math.round(music.durationInSeconds * fps));
          const remainingFrames = Math.max(0, durationInFrames - musicStartFrame);
          const repeatCount = Math.max(1, Math.ceil(remainingFrames / musicClipFrames));

          // Repeat the clip manually instead of using <Loop>: <Loop> resets
          // the local frame to 0 on every cycle, but musicVolumeFn needs the
          // true global frame (voice segments and the fade-out point are
          // absolute timeline positions) — so each repeat gets its own
          // Sequence and reconstructs the global frame inside volume().
          return Array.from({ length: repeatCount }).map((_, i) => {
            const from = musicStartFrame + i * musicClipFrames;
            const thisRepeatFrames = Math.min(musicClipFrames, durationInFrames - from);
            if (thisRepeatFrames <= 0) return null;

            return (
              <Sequence key={i} from={from} durationInFrames={thisRepeatFrames}>
                <Audio
                  src={staticFile(music.relativePath)}
                  volume={(localFrame: number) => musicVolumeFn!(localFrame + from)}
                />
              </Sequence>
            );
          });
        })()}

      {voice.map((v) => (
        <Sequence
          key={v.relativePath}
          from={Math.round(v.startInSeconds * fps)}
          durationInFrames={Math.round(v.durationInSeconds * fps)}
        >
          <Audio src={staticFile(v.relativePath)} volume={() => v.volume ?? 1} />
        </Sequence>
      ))}

      {sfx.map((s) => (
        <Sequence key={`${s.relativePath}-${s.startInSeconds}`} from={Math.round(s.startInSeconds * fps)}>
          <Audio src={staticFile(s.relativePath)} volume={() => s.volume ?? 0.9} />
        </Sequence>
      ))}
    </>
  );
};
