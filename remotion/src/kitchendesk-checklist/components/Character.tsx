import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";

export type CharacterPose = "confused" | "knife" | "explain";

const SRC: Record<CharacterPose, string> = {
  confused: staticFile("characters/chef-confused.png"),
  knife: staticFile("characters/chef-knife.png"),
  explain: staticFile("characters/chef-explain.png"),
};

/**
 * Static illustration with a subtle idle bob/breathing loop so it never
 * reads as a frozen frame, plus an optional entrance slide-up.
 */
export const Character: React.FC<{
  pose: CharacterPose;
  height: number;
  enterAt?: number;
  bottom?: number;
}> = ({ pose, height, enterAt = 0, bottom = -40 }) => {
  const frame = useCurrentFrame();
  const local = frame - enterAt;

  const enterProgress = interpolate(local, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(enterProgress, [0, 1], [60, 0]);
  const opacity = interpolate(local, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const idleBob = Math.sin(frame / 34) * 6;

  return (
    <Img
      src={SRC[pose]}
      style={{
        position: "absolute",
        bottom,
        left: "50%",
        height,
        opacity,
        transform: `translateX(-50%) translateY(${translateY + idleBob}px)`,
        filter: "drop-shadow(0 30px 40px rgba(18,33,63,0.18))",
      }}
    />
  );
};
