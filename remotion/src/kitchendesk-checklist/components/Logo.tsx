import { colors, fonts } from "../theme";

export const Logo: React.FC<{ size?: number; opacity?: number }> = ({
  size = 1,
  opacity = 1,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 * size, opacity }}>
    <div
      style={{
        width: 56 * size,
        height: 56 * size,
        borderRadius: 16 * size,
        background: `linear-gradient(135deg, ${colors.green}, ${colors.greenDark})`,
        boxShadow: "0 16px 32px rgba(34,197,94,0.35)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 12 * size,
          borderRadius: 7 * size,
          border: `${3 * size}px solid #FFFFFF`,
          borderTop: "none",
          borderLeft: "none",
        }}
      />
    </div>
    <span
      style={{
        fontFamily: fonts.display,
        fontWeight: 800,
        fontSize: 48 * size,
        color: colors.navy,
        letterSpacing: -1 * size,
      }}
    >
      KitchenDesk
    </span>
  </div>
);
