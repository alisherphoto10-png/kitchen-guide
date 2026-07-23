import { colors, fonts } from "../theme";

const Half: React.FC<{
  icon: string;
  label: string;
  tone: "amber" | "green";
}> = ({ icon, label, tone }) => {
  const bg = tone === "amber" ? colors.amberSoft : colors.greenSoft;
  const fg = tone === "amber" ? colors.amber : colors.greenDark;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "8px 12px",
      }}
    >
      <div
        style={{
          width: 90,
          height: 90,
          borderRadius: 24,
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 46,
        }}
      >
        {icon}
      </div>
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: 30,
          color: fg,
          textAlign: "center",
          lineHeight: 1.2,
          whiteSpace: "pre-line",
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const SplitCompare: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
    <Half icon="📄" label={"Хаос\nна бумаге"} tone="amber" />
    <span style={{ fontSize: 40, color: colors.navyMuted }}>➜</span>
    <Half icon="✅" label={"Порядок в\nKitchenDesk"} tone="green" />
  </div>
);
