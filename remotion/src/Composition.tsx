import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Composition,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type KitchenDeskProps = {
  title: string;
  tagline: string;
  features: string[];
  cta: string;
};

export const defaultKitchenDeskProps: KitchenDeskProps = {
  title: "KitchenDesk",
  tagline: "Kitchen operations, finally under control",
  features: [
    "Real-time order tracking",
    "Inventory that manages itself",
    "Insights your team will actually use",
  ],
  cta: "kitchendesk.app",
};

const calculateMetadata: CalculateMetadataFunction<KitchenDeskProps> = () => {
  return {};
};

export const KitchenDeskPromo = () => {
  return (
    <Composition
      id="KitchenDeskPromo"
      component={PromoVideo}
      durationInFrames={210}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultKitchenDeskProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

const GreenGlow: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(circle at 20% 20%, rgba(34,197,94,0.18), transparent 55%), radial-gradient(circle at 80% 75%, rgba(16,185,129,0.14), transparent 50%)",
    }}
  />
);

const LogoScene: React.FC<{ title: string; tagline: string }> = ({
  title,
  tagline,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const taglineOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const taglineShift = interpolate(frame, [20, 35], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "linear-gradient(135deg, #22c55e, #15803d)",
            boxShadow: "0 0 40px rgba(34,197,94,0.5)",
          }}
        />
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 64,
            fontWeight: 800,
            color: "#f8faf9",
            letterSpacing: -1,
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 26,
          color: "#9ca3af",
          opacity: taglineOpacity,
          transform: `translateY(${taglineShift}px)`,
        }}
      >
        {tagline}
      </div>
    </AbsoluteFill>
  );
};

const FeatureRow: React.FC<{ text: string; index: number }> = ({
  text,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = index * 12;
  const progress = spring({
    frame: frame - start,
    fps,
    config: { damping: 16 },
  });
  const opacity = interpolate(frame - start, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        opacity,
        transform: `translateX(${(1 - progress) * -40}px)`,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#22c55e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#0b0f0d", fontWeight: 900, fontSize: 16 }}>
          ✓
        </span>
      </div>
      <span
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 32,
          color: "#e5e7eb",
        }}
      >
        {text}
      </span>
    </div>
  );
};

const FeatureScene: React.FC<{ features: string[] }> = ({ features }) => (
  <AbsoluteFill
    style={{
      alignItems: "flex-start",
      justifyContent: "center",
      flexDirection: "column",
      paddingLeft: 140,
      gap: 28,
    }}
  >
    {features.map((text, index) => (
      <FeatureRow key={text} text={text} index={index} />
    ))}
  </AbsoluteFill>
);

const CtaScene: React.FC<{ cta: string }> = ({ cta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 30,
            color: "#9ca3af",
          }}
        >
          Try it today
        </span>
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 48,
            fontWeight: 800,
            color: "#22c55e",
          }}
        >
          {cta}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export const PromoVideo: React.FC<KitchenDeskProps> = ({
  title,
  tagline,
  features,
  cta,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0f0d" }}>
      <GreenGlow />
      <Sequence  durationInFrames={70}>
        <LogoScene title={title} tagline={tagline} />
      </Sequence>
      <Sequence from={60} durationInFrames={100}>
        <FeatureScene features={features} />
      </Sequence>
      <Sequence from={160} durationInFrames={50}>
        <CtaScene cta={cta} />
      </Sequence>
    </AbsoluteFill>
  );
};
