import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./Card";
import { colors, fonts, easeOut } from "../theme";

export const DominoCard: React.FC<{
  icon: string;
  label: string;
  delay: number;
}> = ({ icon, label, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;

  const fall = spring({
    frame: local,
    fps,
    config: { damping: 11, mass: 0.7, stiffness: 140 },
  });
  const opacity = interpolate(local, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotate = interpolate(fall, [0, 1], [-14, 0], { easing: easeOut });
  const translateY = interpolate(fall, [0, 1], [-50, 0], { easing: easeOut });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) rotate(${rotate}deg)`,
      }}
    >
      <Card width={700} style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            background: colors.amberSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 40,
            color: colors.navy,
          }}
        >
          {label}
        </span>
      </Card>
    </div>
  );
};

export const DominoArrow: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        display: "flex",
        justifyContent: "center",
        fontSize: 44,
        color: colors.navyMuted,
      }}
    >
      ↓
    </div>
  );
};
