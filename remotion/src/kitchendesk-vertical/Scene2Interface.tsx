import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Background } from "./components/Background";
import { AppScreen, ScreenKind } from "./components/ScreenMock";
import { easeOut } from "./theme";

const ORDER: ScreenKind[] = ["prep", "checklist", "ttk", "shift"];
const SEGMENT = 78;
const CROSSFADE = 18;

const ScreenSlot: React.FC<{ kind: ScreenKind; index: number }> = ({
  kind,
  index,
}) => {
  const frame = useCurrentFrame();
  const start = index * SEGMENT;
  const local = frame - start;

  const opacity = interpolate(
    local,
    [0, CROSSFADE, SEGMENT - CROSSFADE, SEGMENT],
    [0, 1, 1, 0],
    { easing: easeOut, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const scale = interpolate(
    local,
    [0, CROSSFADE, SEGMENT - CROSSFADE, SEGMENT],
    [0.9, 1, 1, 1.06],
    { easing: easeOut, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = interpolate(local, [0, SEGMENT], [26, -26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotateX = interpolate(local, [0, CROSSFADE], [6, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (opacity <= 0) return null;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
        perspective: 1400,
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px) scale(${scale}) rotateX(${rotateX}deg)`,
        }}
      >
        <AppScreen kind={kind} />
      </div>
    </AbsoluteFill>
  );
};

export const Scene2Interface: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background intensity={0.8} />
      {ORDER.map((kind, index) => (
        <ScreenSlot key={kind} kind={kind} index={index} />
      ))}
    </AbsoluteFill>
  );
};
