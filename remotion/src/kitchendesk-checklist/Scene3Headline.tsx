import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { colors, fonts } from "./theme";

const Word: React.FC<{
  text: string;
  delay: number;
  color: string;
}> = ({ text, delay, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;

  const pop = spring({
    frame: local,
    fps,
    config: { damping: 12, mass: 0.6, stiffness: 160 },
  });
  const opacity = interpolate(local, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        transform: `scale(${0.6 + pop * 0.4})`,
        fontFamily: fonts.display,
        fontWeight: 900,
        fontSize: 76,
        color,
        letterSpacing: -1,
      }}
    >
      {text}
    </span>
  );
};

export const Scene3Headline: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background tint="warm" />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 18,
          padding: "0 70px",
        }}
      >
        <div style={{ display: "flex", gap: 22 }}>
          <Word text="ЭТО" delay={0} color={colors.navy} />
          <Word text="ТВОЯ" delay={10} color={colors.navy} />
        </div>
        <Word text="КУХНЯ" delay={20} color={colors.navy} />
        <div style={{ height: 8 }} />
        <div style={{ display: "flex", gap: 22 }}>
          <Word text="ПРЯМО" delay={45} color={colors.amber} />
          <Word text="СЕЙЧАС" delay={58} color={colors.amber} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
