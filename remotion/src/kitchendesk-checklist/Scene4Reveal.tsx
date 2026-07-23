import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Character } from "./components/Character";
import { Card } from "./components/Card";
import { SplitCompare } from "./components/SplitCompare";
import { Logo } from "./components/Logo";
import { colors, fonts } from "./theme";

const FOREGROUND_END = 260;
const OUTRO_START = 260;

export const Scene4Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const captionOpacity = interpolate(frame, [16, 32, 65, 85], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const compareOpacity = interpolate(frame, [85, 105], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const compareScale = spring({
    frame: frame - 85,
    fps,
    config: { damping: 200, mass: 0.9, stiffness: 110 },
  });

  const foregroundOpacity = interpolate(
    frame,
    [FOREGROUND_END - 20, FOREGROUND_END + 10],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const logoOpacity = interpolate(frame, [OUTRO_START + 30, OUTRO_START + 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logoScale = spring({
    frame: frame - OUTRO_START - 30,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
  });

  const taglineOpacity = interpolate(frame, [OUTRO_START + 70, OUTRO_START + 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [OUTRO_START + 70, OUTRO_START + 100], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background tint="green" />

      <AbsoluteFill style={{ opacity: foregroundOpacity }}>
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 260 }}>
          <div style={{ opacity: captionOpacity, marginBottom: 24 }}>
            <Card width={360} style={{ textAlign: "center" }}>
              <span
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: 42,
                  color: colors.navy,
                }}
              >
                Или...
              </span>
            </Card>
          </div>

          <div
            style={{
              opacity: compareOpacity,
              transform: `scale(${0.85 + compareScale * 0.15})`,
            }}
          >
            <Card width={860}>
              <SplitCompare />
            </Card>
          </div>
        </AbsoluteFill>

        <Character pose="knife" height={1500} enterAt={0} bottom={-140} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 30,
        }}
      >
        <div style={{ transform: `scale(${0.7 + logoScale * 0.3})`, opacity: logoOpacity }}>
          <Logo size={1.1} />
        </div>
        <span
          style={{
            fontFamily: fonts.body,
            fontWeight: 500,
            fontSize: 34,
            color: colors.navyMuted,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            textAlign: "center",
            maxWidth: 760,
          }}
        >
          KitchenDesk — и хаоса больше нет
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
