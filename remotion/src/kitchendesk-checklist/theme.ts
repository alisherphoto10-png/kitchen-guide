import { Easing } from "remotion";

export const colors = {
  bg: "#F2F4F7",
  bgTop: "#FFFFFF",
  card: "#FFFFFF",
  navy: "#12213F",
  navyMuted: "rgba(18, 33, 63, 0.6)",
  navyFaint: "rgba(18, 33, 63, 0.08)",
  green: "#22C55E",
  greenDark: "#15803D",
  greenSoft: "rgba(34, 197, 94, 0.14)",
  amber: "#F59E0B",
  amberSoft: "rgba(245, 158, 11, 0.14)",
  border: "rgba(18, 33, 63, 0.10)",
} as const;

export const fonts = {
  display: "Manrope, Inter, sans-serif",
  body: "Inter, sans-serif",
} as const;

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
