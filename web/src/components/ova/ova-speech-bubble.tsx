"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";

const PHRASES = [
  "Привет! Как дела на кухне?",
  "Готовим что-то вкусное сегодня?",
  "Я слежу, чтобы дежурства не срывались.",
  "ТТК всегда под рукой — прямо в кармане.",
  "Акты разделки? Уже посчитал отход.",
  "Порядок на кухне — моя забота.",
  "Нужна помощь? Я рядом.",
  "Хорошей смены!",
];

const INITIAL_DELAY_MS = 2400;
const VISIBLE_DURATION_MS = 4200;
const GAP_DURATION_MS = 3200;

export function OvaSpeechBubble({ anchorRef }: { anchorRef: RefObject<HTMLElement | null> }) {
  const prefersReducedMotion = useReducedMotion();
  const isInView = useInView(anchorRef, { amount: 0.4 });
  const [phraseIndex, setPhraseIndex] = useState<number | null>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion || !isInView) {
      return;
    }

    let visibleTimeout: ReturnType<typeof setTimeout>;
    let gapTimeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function showNext() {
      const index = counterRef.current % PHRASES.length;
      counterRef.current += 1;
      setPhraseIndex(index);

      visibleTimeout = setTimeout(() => {
        if (cancelled) return;
        setPhraseIndex(null);
        gapTimeout = setTimeout(() => {
          if (!cancelled) showNext();
        }, GAP_DURATION_MS);
      }, VISIBLE_DURATION_MS);
    }

    const startTimeout = setTimeout(showNext, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(startTimeout);
      clearTimeout(visibleTimeout);
      clearTimeout(gapTimeout);
    };
  }, [isInView, prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="pointer-events-none absolute top-[2%] right-[-4%] z-10 w-[200px] sm:w-[230px]">
      <AnimatePresence mode="wait">
        {isInView && phraseIndex !== null && (
          <motion.div
            key={phraseIndex}
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-snug text-text shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]"
          >
            {PHRASES[phraseIndex]}
            <span
              aria-hidden
              className="absolute -bottom-1.5 left-9 h-3 w-3 rotate-45 border-b border-r border-border bg-card"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
