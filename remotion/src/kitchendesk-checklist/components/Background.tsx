import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

export const Background: React.FC<{ tint?: "neutral" | "warm" | "green" }> = ({
  tint = "neutral",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const drift = interpolate(frame, [0, durationInFrames], [1, 1.04]);

  const glow =
    tint === "warm"
      ? "radial-gradient(circle at 50% 15%, rgba(245,158,11,0.10), transparent 50%)"
      : tint === "green"
        ? "radial-gradient(circle at 50% 15%, rgba(34,197,94,0.12), transparent 50%)"
        : "radial-gradient(circle at 50% 10%, rgba(18,33,63,0.06), transparent 50%)";

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${colors.bgTop} 0%, ${colors.bg} 60%)`,
        }}
      />
      <AbsoluteFill style={{ transform: `scale(${drift})`, background: glow }} />
      <AbsoluteFill
        style={{
          opacity: 0.5,
          backgroundImage:
            "linear-gradient(rgba(18,33,63,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(18,33,63,0.05) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
    </AbsoluteFill>
  );
};
