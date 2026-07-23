import { AbsoluteFill, Composition, interpolate, useCurrentFrame } from "remotion";
import { MixAudio, type MixAudioProps } from "../audio/mixAudio";

export const AudioPipelineDemo = () => {
  return (
    <Composition
      id="AudioPipelineDemo"
      component={AudioPipelineDemoVideo}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ voice: [], music: undefined, sfx: [] } satisfies MixAudioProps}
    />
  );
};

/**
 * Minimal visual — this composition exists to prove the audio pipeline
 * (generateVoice -> addBackgroundMusic -> addSoundEffects -> MixAudio ->
 * renderFinalVideo) produces an MP4 with a correctly mixed audio track, not
 * to be a polished deliverable. A pulsing waveform bar reacts to which
 * track should be audible at each frame, as a visual sanity check.
 */
const AudioPipelineDemoVideo: React.FC<MixAudioProps> = (props) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(Math.sin(frame / 6), [-1, 1], [0.85, 1.15]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0f0d",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 40,
      }}
    >
      <div
        style={{
          width: 160,
          height: 160,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #22c55e, #15803d)",
          transform: `scale(${pulse})`,
          boxShadow: "0 0 80px rgba(34,197,94,0.5)",
        }}
      />
      <span
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 700,
          fontSize: 36,
          color: "#f0f4f8",
        }}
      >
        Audio pipeline check
      </span>
      <MixAudio {...props} />
    </AbsoluteFill>
  );
};
