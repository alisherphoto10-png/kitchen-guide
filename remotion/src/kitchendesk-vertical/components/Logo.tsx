import { colors, fonts } from "../theme";

export const Logo: React.FC<{ size?: number; opacity?: number }> = ({
  size = 1,
  opacity = 1,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18 * size,
        opacity,
      }}
    >
      <div
        style={{
          width: 64 * size,
          height: 64 * size,
          borderRadius: 18 * size,
          background: `linear-gradient(135deg, ${colors.green}, #0f7a3d)`,
          boxShadow: `0 0 ${60 * size}px rgba(34,197,94,0.45)`,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 14 * size,
            borderRadius: 8 * size,
            border: `${3 * size}px solid rgba(4,8,22,0.9)`,
            borderTop: "none",
            borderLeft: "none",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: 56 * size,
          color: colors.ink,
          letterSpacing: -1 * size,
        }}
      >
        KitchenDesk
      </span>
    </div>
  );
};
