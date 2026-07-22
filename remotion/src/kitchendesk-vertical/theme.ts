import { Easing } from "remotion";

export const colors = {
  bg: "#040816",
  bgElevated: "#0a1122",
  green: "#22C55E",
  greenSoft: "rgba(34, 197, 94, 0.16)",
  ink: "#F0F4F8",
  inkMuted: "rgba(240, 244, 248, 0.6)",
  inkFaint: "rgba(240, 244, 248, 0.35)",
  border: "rgba(240, 244, 248, 0.08)",
} as const;

export const fonts = {
  display: "Manrope, Inter, sans-serif",
  body: "Inter, sans-serif",
} as const;

// Standard cinematic ease — slow start, fast middle, gentle settle.
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
