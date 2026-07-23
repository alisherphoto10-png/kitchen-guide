import { AbsoluteFill } from "remotion";
import { Background } from "./components/Background";
import { DominoArrow, DominoCard } from "./components/DominoCard";

const STEPS = [
  { icon: "⏰", label: "Просрочка", delay: 10 },
  { icon: "💸", label: "Штраф", delay: 95 },
  { icon: "😠", label: "Недовольный гость", delay: 180 },
];

export const Scene2Domino: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background tint="warm" />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
        }}
      >
        <DominoCard icon={STEPS[0].icon} label={STEPS[0].label} delay={STEPS[0].delay} />
        <DominoArrow delay={STEPS[0].delay + 40} />
        <DominoCard icon={STEPS[1].icon} label={STEPS[1].label} delay={STEPS[1].delay} />
        <DominoArrow delay={STEPS[1].delay + 40} />
        <DominoCard icon={STEPS[2].icon} label={STEPS[2].label} delay={STEPS[2].delay} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
