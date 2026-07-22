import { colors, fonts } from "../theme";

export type ScreenKind = "prep" | "checklist" | "ttk" | "shift";

export const screenMeta: Record<ScreenKind, { title: string; icon: string }> = {
  prep: { title: "План заготовок", icon: "📋" },
  checklist: { title: "Чек-листы", icon: "✅" },
  ttk: { title: "ТТК", icon: "📖" },
  shift: { title: "Контроль смены", icon: "⏱" },
};

const CardShell: React.FC<{
  title: string;
  icon: string;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div
    style={{
      width: 760,
      borderRadius: 32,
      background: colors.bgElevated,
      border: `1px solid ${colors.border}`,
      boxShadow: "0 40px 100px rgba(0,0,0,0.55)",
      padding: 40,
      display: "flex",
      flexDirection: "column",
      gap: 28,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: colors.greenSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
        }}
      >
        {icon}
      </div>
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 700,
          fontSize: 34,
          color: colors.ink,
        }}
      >
        {title}
      </span>
    </div>
    {children}
  </div>
);

const ProgressRow: React.FC<{ label: string; qty: string; progress: number }> = ({
  label,
  qty,
  progress,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontFamily: fonts.body, fontSize: 26, color: colors.ink }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: fonts.body,
          fontSize: 22,
          color: colors.inkMuted,
        }}
      >
        {qty}
      </span>
    </div>
    <div
      style={{
        height: 10,
        borderRadius: 999,
        background: "rgba(240,244,248,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${colors.green}, #0f7a3d)`,
        }}
      />
    </div>
  </div>
);

const CheckRow: React.FC<{ label: string; done: boolean }> = ({
  label,
  done,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        background: done ? colors.green : "rgba(240,244,248,0.06)",
        border: done ? "none" : `1px solid ${colors.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {done && (
        <span style={{ color: colors.bg, fontWeight: 900, fontSize: 18 }}>
          ✓
        </span>
      )}
    </div>
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 27,
        color: done ? colors.inkMuted : colors.ink,
        textDecoration: done ? "line-through" : "none",
      }}
    >
      {label}
    </span>
  </div>
);

const TtkRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "14px 0",
      borderBottom: `1px solid ${colors.border}`,
    }}
  >
    <span style={{ fontFamily: fonts.body, fontSize: 25, color: colors.inkMuted }}>
      {label}
    </span>
    <span style={{ fontFamily: fonts.body, fontSize: 25, color: colors.ink }}>
      {value}
    </span>
  </div>
);

const ShiftRow: React.FC<{ name: string; status: string; online: boolean }> = ({
  name,
  status,
  online,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: online ? colors.green : "rgba(240,244,248,0.25)",
        boxShadow: online ? `0 0 12px ${colors.green}` : "none",
        flexShrink: 0,
      }}
    />
    <span style={{ fontFamily: fonts.body, fontSize: 27, color: colors.ink, flex: 1 }}>
      {name}
    </span>
    <span style={{ fontFamily: fonts.body, fontSize: 22, color: colors.inkMuted }}>
      {status}
    </span>
  </div>
);

export const AppScreen: React.FC<{ kind: ScreenKind }> = ({ kind }) => {
  const meta = screenMeta[kind];

  if (kind === "prep") {
    return (
      <CardShell title={meta.title} icon={meta.icon}>
        <ProgressRow label="Бульон куриный" qty="12 / 20 л" progress={0.6} />
        <ProgressRow label="Соус демиглас" qty="8 / 8 л" progress={1} />
        <ProgressRow label="Тесто для пиццы" qty="30 / 60 шт" progress={0.5} />
      </CardShell>
    );
  }

  if (kind === "checklist") {
    return (
      <CardShell title={meta.title} icon={meta.icon}>
        <CheckRow label="Проверка холодильников" done />
        <CheckRow label="Санитарная обработка station" done />
        <CheckRow label="Контроль сроков годности" done={false} />
        <CheckRow label="Приёмка поставки" done={false} />
      </CardShell>
    );
  }

  if (kind === "ttk") {
    return (
      <CardShell title={meta.title} icon={meta.icon}>
        <TtkRow label="Блюдо" value="Ризотто с грибами" />
        <TtkRow label="Выход, г" value="320" />
        <TtkRow label="Калорийность" value="410 ккал" />
        <TtkRow label="Время приготовления" value="18 мин" />
      </CardShell>
    );
  }

  return (
    <CardShell title={meta.title} icon={meta.icon}>
      <ShiftRow name="Смена: горячий цех" status="в норме" online />
      <ShiftRow name="Иван — су-шеф" status="на месте" online />
      <ShiftRow name="Мария — заготовки" status="на месте" online />
      <ShiftRow name="Опоздания" status="0" online={false} />
    </CardShell>
  );
};
