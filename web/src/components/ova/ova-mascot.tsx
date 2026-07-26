"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  animate,
  useReducedMotion,
} from "framer-motion";
import heroSprite from "@/assets/ova/ova-hero.png";

const BLINK_INTERVAL_MS = 4200;
const BLINK_INTERVAL_JITTER_MS = 2600;
const BLINK_DURATION_SECONDS = 0.16;

const FACE_REGION = {
  left: "30.5%",
  top: "21.5%",
  width: "41%",
  height: "12%",
};

const TILT_RANGE_DEGREES = 6;

// Traces the raised arm+hand in ova-hero.png (as % of the image box) so it can be
// masked out of the body layer and re-drawn as its own rotatable layer, pivoting
// from the shoulder. There's no rigged/layered source art, so this is a hand-tuned
// approximation — generous enough to cover the limb through the wave's rotation range.
const ARM_POLYGON_POINTS: Array<[number, number]> = [
  [35, 50],
  [24, 44],
  [12, 36],
  [3, 27],
  [0, 15],
  [0, 0],
  [31, 0],
  [33, 14],
  [30, 26],
  [24, 38],
];
const SHOULDER_PIVOT = { x: 35, y: 50 };

const ARM_CLIP_PATH = `polygon(${ARM_POLYGON_POINTS.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;

const BODY_MASK_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<rect width="100" height="100" fill="white"/>` +
    `<polygon points="${ARM_POLYGON_POINTS.map(([x, y]) => `${x},${y}`).join(" ")}" fill="black"/>` +
    `</svg>`,
)}")`;

const WAVE_ROTATION_KEYFRAMES = [0, -9, 6, -7, 6, -2, 0];
const WAVE_DURATION_SECONDS = 1.7;
const WAVE_PAUSE_MS = 2600;

export function OvaMascot() {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const blinkScaleY = useMotionValue(0);
  const armRotate = useMotionValue(0);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 60, damping: 14 });
  const springY = useSpring(pointerY, { stiffness: 60, damping: 14 });
  const rotateX = useTransform(springY, [-1, 1], [TILT_RANGE_DEGREES, -TILT_RANGE_DEGREES]);
  const rotateY = useTransform(springX, [-1, 1], [-TILT_RANGE_DEGREES, TILT_RANGE_DEGREES]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    function handlePointerMove(event: PointerEvent) {
      const normalizedX = (event.clientX / window.innerWidth) * 2 - 1;
      const normalizedY = (event.clientY / window.innerHeight) * 2 - 1;
      pointerX.set(normalizedX);
      pointerY.set(normalizedY);
    }

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [pointerX, pointerY, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    function scheduleBlink() {
      const delay = BLINK_INTERVAL_MS + Math.random() * BLINK_INTERVAL_JITTER_MS;
      timeoutId = setTimeout(async () => {
        await animate(blinkScaleY, 1, { duration: BLINK_DURATION_SECONDS / 2 });
        await animate(blinkScaleY, 0, { duration: BLINK_DURATION_SECONDS / 2 });
        scheduleBlink();
      }, delay);
    }

    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, [blinkScaleY, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function scheduleWave() {
      await animate(armRotate, WAVE_ROTATION_KEYFRAMES, {
        duration: WAVE_DURATION_SECONDS,
        ease: "easeInOut",
      });
      if (cancelled) return;
      timeoutId = setTimeout(scheduleWave, WAVE_PAUSE_MS);
    }

    scheduleWave();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [armRotate, prefersReducedMotion]);

  return (
    <motion.div
      ref={containerRef}
      className="relative mx-auto w-fit"
      style={{ perspective: 900 }}
      initial={{ opacity: 0, y: 32, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
    >
      <motion.div
        style={prefersReducedMotion ? undefined : { rotateX, rotateY }}
        animate={
          prefersReducedMotion
            ? undefined
            : { y: [0, -10, 0], rotate: [0, -1.2, 0, 1.2, 0] }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : { duration: 5.5, repeat: Infinity, ease: "easeInOut" }
        }
        className="relative"
      >
        <Image
          src={heroSprite}
          alt="OVA, робот-шеф KitchenDesk, приветствует вас"
          priority
          placeholder="blur"
          className="h-[clamp(400px,52vw,620px)] w-auto select-none"
          style={
            prefersReducedMotion
              ? undefined
              : {
                  WebkitMaskImage: BODY_MASK_IMAGE,
                  maskImage: BODY_MASK_IMAGE,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                }
          }
        />

        {!prefersReducedMotion && (
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{
              rotate: armRotate,
              transformOrigin: `${SHOULDER_PIVOT.x}% ${SHOULDER_PIVOT.y}%`,
              clipPath: ARM_CLIP_PATH,
            }}
          >
            <Image
              src={heroSprite}
              alt=""
              aria-hidden
              className="h-[clamp(400px,52vw,620px)] w-auto select-none"
            />
          </motion.div>
        )}

        <motion.span
          aria-hidden
          className="pointer-events-none absolute rounded-[40%] bg-[#05070d]"
          style={{
            left: FACE_REGION.left,
            top: FACE_REGION.top,
            width: FACE_REGION.width,
            height: FACE_REGION.height,
            scaleY: blinkScaleY,
            transformOrigin: "center",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
