import { Composition } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1Hook } from "./Scene1Hook";
import { Scene2Domino } from "./Scene2Domino";
import { Scene3Headline } from "./Scene3Headline";
import { Scene4Reveal } from "./Scene4Reveal";
import { colors } from "./theme";

const FPS = 60;

// Spec timing (seconds -> frames @ 60fps): 4s / 5s / 4s / 7s = 20s total.
// Each non-final scene gets +12 frames so the 12-frame fade transitions have
// footage to cross-dissolve into/out of without shortening the spec beats.
const SCENE_DURATIONS = {
  hook: 4 * FPS + 12,
  domino: 5 * FPS + 12,
  headline: 4 * FPS + 12,
  reveal: 7 * FPS,
};

const TRANSITION_FRAMES = 12;

export const TOTAL_DURATION_IN_FRAMES =
  SCENE_DURATIONS.hook +
  SCENE_DURATIONS.domino +
  SCENE_DURATIONS.headline +
  SCENE_DURATIONS.reveal -
  TRANSITION_FRAMES * 3;

export const KitchenDeskChecklistReel = () => {
  return (
    <Composition
      id="KitchenDeskChecklistReel"
      component={KitchenDeskChecklistReelVideo}
      durationInFrames={TOTAL_DURATION_IN_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{}}
    />
  );
};

export const KitchenDeskChecklistReelVideo: React.FC = () => {
  return (
    <TransitionSeries style={{ backgroundColor: colors.bg }}>
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.hook}>
        <Scene1Hook />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.domino}>
        <Scene2Domino />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.headline}>
        <Scene3Headline />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />

      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.reveal}>
        <Scene4Reveal />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
