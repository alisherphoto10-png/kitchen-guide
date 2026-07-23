import { colors } from "../theme";

export const Card: React.FC<{
  children: React.ReactNode;
  width?: number;
  style?: React.CSSProperties;
}> = ({ children, width = 780, style }) => (
  <div
    style={{
      width,
      borderRadius: 28,
      background: colors.card,
      border: `1px solid ${colors.border}`,
      boxShadow: "0 30px 70px rgba(18,33,63,0.14)",
      padding: 32,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Pill: React.FC<{
  label: string;
  tone?: "navy" | "green" | "amber";
}> = ({ label, tone = "navy" }) => {
  const bg =
    tone === "green" ? colors.green : tone === "amber" ? colors.amber : colors.navy;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "14px 32px",
        borderRadius: 999,
        background: bg,
        boxShadow: `0 16px 32px ${tone === "green" ? "rgba(34,197,94,0.35)" : tone === "amber" ? "rgba(245,158,11,0.35)" : "rgba(18,33,63,0.35)"}`,
      }}
    >
      <span
        style={{
          fontFamily: "Manrope, Inter, sans-serif",
          fontWeight: 800,
          fontSize: 30,
          color: "#FFFFFF",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
    </div>
  );
};
