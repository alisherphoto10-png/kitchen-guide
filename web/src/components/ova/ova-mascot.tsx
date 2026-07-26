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
import { OvaSpeechBubble } from "./ova-speech-bubble";

const BLINK_INTERVAL_MS = 4200;
const BLINK_INTERVAL_JITTER_MS = 2600;
const BLINK_DURATION_SECONDS = 0.16;

const FACE_REGION = {
  left: "34.5%",
  top: "23.5%",
  width: "41%",
  height: "14%",
};

const TILT_RANGE_DEGREES = 6;

export function OvaMascot() {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const blinkScaleY = useMotionValue(0);

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
        />
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
        <OvaSpeechBubble anchorRef={containerRef} />
      </motion.div>
    </motion.div>
  );
}
