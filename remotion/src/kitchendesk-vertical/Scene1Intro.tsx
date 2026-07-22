import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Logo } from "./components/Logo";
import { colors, fonts } from "./theme";

export const Scene1Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
  });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [45, 75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [45, 75], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background intensity={0.5} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <div
          style={{
            transform: `scale(${0.7 + logoScale * 0.3})`,
            opacity: logoOpacity,
          }}
        >
          <Logo size={1.15} />
        </div>
        <span
          style={{
            fontFamily: fonts.body,
            fontWeight: 500,
            fontSize: 38,
            color: colors.inkMuted,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            textAlign: "center",
            maxWidth: 800,
          }}
        >
          Управление кухней нового поколения
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
