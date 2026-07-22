import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { AppScreen, ScreenKind } from "./components/ScreenMock";
import { Logo } from "./components/Logo";
import { colors, easeOut, fonts } from "./theme";

const STACK: { kind: ScreenKind; offsetX: number; offsetY: number; z: number }[] = [
  { kind: "ttk", offsetX: 60, offsetY: 40, z: 0 },
  { kind: "checklist", offsetX: -50, offsetY: -10, z: 1 },
  { kind: "prep", offsetX: 0, offsetY: -60, z: 2 },
];

export const Scene4Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stackScale = interpolate(frame, [0, 85], [0.42, 0.1], {
    easing: easeOut,
    extrapolateRight: "clamp",
  });
  const stackOpacity = interpolate(frame, [0, 70, 90], [1, 0.6, 0], {
    extrapolateRight: "clamp",
  });

  const logoScale = spring({
    frame: frame - 55,
    fps,
    config: { damping: 200, mass: 1, stiffness: 90 },
  });
  const logoOpacity = interpolate(frame, [55, 85], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [130, 165], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [130, 165], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background intensity={0.5} />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", opacity: stackOpacity }}>
          {STACK.map(({ kind, offsetX, offsetY, z }) => (
            <div
              key={kind}
              style={{
                position: "absolute",
                left: offsetX,
                top: offsetY,
                zIndex: z,
                transform: `scale(${stackScale})`,
                transformOrigin: "center",
              }}
            >
              <AppScreen kind={kind} />
            </div>
          ))}
        </div>
      </AbsoluteFill>

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
            fontSize: 34,
            color: colors.inkMuted,
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            textAlign: "center",
            maxWidth: 760,
          }}
        >
          KitchenDesk — цифровая кухня нового поколения
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
