import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

/**
 * Slow cinematic drift: a very subtle continuous zoom + glow pulse so no
 * frame ever feels perfectly static, without competing with foreground motion.
 */
export const Background: React.FC<{ intensity?: number }> = ({
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const drift = interpolate(frame, [0, durationInFrames], [1, 1 + 0.06 * intensity]);
  const glowShift = interpolate(
    frame,
    [0, durationInFrames],
    [-6, 6],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${drift})`,
          background: `
            radial-gradient(circle at ${50 + glowShift}% 18%, rgba(34,197,94,0.16), transparent 45%),
            radial-gradient(circle at ${28 - glowShift}% 82%, rgba(34,197,94,0.10), transparent 50%)
          `,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage:
            "linear-gradient(rgba(240,244,248,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(240,244,248,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, rgba(4,8,22,0.85) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
