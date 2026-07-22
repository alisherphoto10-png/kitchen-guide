import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

export const CheckItem: React.FC<{ label: string; delay: number }> = ({
  label,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;

  const enter = spring({
    frame: local,
    fps,
    config: { damping: 200, mass: 0.9, stiffness: 120 },
  });
  const opacity = interpolate(local, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = interpolate(enter, [0, 1], [-72, 0]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        opacity,
        transform: `translateX(${x}px)`,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${colors.green}, #0f7a3d)`,
          boxShadow: "0 12px 30px rgba(34,197,94,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ color: colors.bg, fontWeight: 900, fontSize: 28 }}>
          ✓
        </span>
      </div>
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: 44,
          color: colors.ink,
        }}
      >
        {label}
      </span>
    </div>
  );
};
