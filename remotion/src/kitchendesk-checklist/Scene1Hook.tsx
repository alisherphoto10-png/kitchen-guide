import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Character } from "./components/Character";
import { Card } from "./components/Card";
import { colors, fonts } from "./theme";

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardScale = spring({
    frame: frame - 24,
    fps,
    config: { damping: 200, mass: 0.9, stiffness: 110 },
  });
  const cardOpacity = interpolate(frame, [24, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background tint="neutral" />

      <AbsoluteFill style={{ alignItems: "center", paddingTop: 340 }}>
        <div style={{ transform: `scale(${0.85 + cardScale * 0.15})`, opacity: cardOpacity }}>
          <Card width={820}>
            <span
              style={{
                fontFamily: fonts.display,
                fontWeight: 700,
                fontSize: 46,
                color: colors.navy,
                lineHeight: 1.25,
              }}
            >
              Один забытый чек-лист<span style={{ color: colors.amber }}>...</span>
            </span>
          </Card>
        </div>
      </AbsoluteFill>

      <Character pose="confused" height={1500} enterAt={0} bottom={-120} />
    </AbsoluteFill>
  );
};
