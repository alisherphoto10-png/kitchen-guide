import { Composition } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1Intro } from "./Scene1Intro";
import { Scene2Interface } from "./Scene2Interface";
import { Scene3Benefits } from "./Scene3Benefits";
import { Scene4Outro } from "./Scene4Outro";
import { colors } from "./theme";

const FPS = 60;

// Spec timing (seconds -> frames @ 60fps): 4s / 5s / 6s / 5s = 20s total.
// Each scene gets +12 frames of extra footage so the 12-frame fade
// transitions have something to cross-dissolve into/out of without
// shortening the visible content below the spec durations.
const SCENE_DURATIONS = {
  intro: 4 * FPS + 12,
  interface: 5 * FPS + 12,
  benefits: 6 * FPS + 12,
  outro: 5 * FPS,
};

const TRANSITION_FRAMES = 12;

export const TOTAL_DURATION_IN_FRAMES =
  SCENE_DURATIONS.intro +
  SCENE_DURATIONS.interface +
  SCENE_DURATIONS.benefits +
  SCENE_DURATIONS.outro -
  TRANSITION_FRAMES * 3;

export const KitchenDeskVerticalPromo = () => {
  return (
    <Composition
      id="KitchenDeskVerticalPromo"
      component={KitchenDeskVerticalPromoVideo}
      durationInFrames={TOTAL_DURATION_IN_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{}}
    />
  );
};

export const KitchenDeskVerticalPromoVideo: React.FC = () => {
  return (
    <TransitionSeries style={{ backgroundColor: colors.bg }}>
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.intro}>
        <Scene1Intro />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.interface}>
        <Scene2Interface />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.benefits}>
        <Scene3Benefits />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.outro}>
        <Scene4Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
