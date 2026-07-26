"use client";

import dynamic from "next/dynamic";

const Ova3DScene = dynamic(
  () => import("./ova-3d-scene").then((mod) => mod.Ova3DScene),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="h-full w-full rounded-full bg-[radial-gradient(circle,var(--glow-accent-soft)_0%,transparent_70%)]"
      />
    ),
  },
);

export function OvaSceneLoader() {
  return (
    <div aria-hidden className="absolute inset-0">
      <Ova3DScene />
    </div>
  );
}
