import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { AppScreen } from "./components/ScreenMock";
import { CheckItem } from "./components/CheckItem";

const BENEFITS = [
  "Всё в одном месте",
  "Без бумаги",
  "Работа быстрее",
  "Контроль в реальном времени",
];

const DELAYS = [0, 90, 180, 270];

const DriftingScreen: React.FC<{
  kind: "prep" | "checklist" | "ttk" | "shift";
  top: string;
  side: "left" | "right";
  scale: number;
  speed: number;
}> = ({ kind, top, side, scale, speed }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const translateY = interpolate(
    frame,
    [0, durationInFrames],
    [40 * speed, -40 * speed],
  );

  return (
    <div
      style={{
        position: "absolute",
        top,
        [side]: -180,
        transform: `translateY(${translateY}px) scale(${scale})`,
        filter: "blur(6px)",
        opacity: 0.32,
        pointerEvents: "none",
      }}
    >
      <AppScreen kind={kind} />
    </div>
  );
};

export const Scene3Benefits: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background intensity={0.9} />
      <DriftingScreen kind="prep" top="4%" side="right" scale={0.55} speed={1} />
      <DriftingScreen kind="shift" top="62%" side="left" scale={0.5} speed={-1.3} />

      <AbsoluteFill
        style={{
          alignItems: "flex-start",
          justifyContent: "center",
          paddingLeft: 96,
          paddingRight: 64,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
          {BENEFITS.map((label, i) => (
            <CheckItem key={label} label={label} delay={DELAYS[i]} />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
