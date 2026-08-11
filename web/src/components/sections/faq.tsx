"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Badge, Container, Heading, Section, Text } from "@/components/ui";
import { getLandingFaq, type FaqEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

const ITEM_REVEAL_DISTANCE_PX = 16;

export function Faq() {
  const [items, setItems] = useState<FaqEntry[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLandingFaq()
      .then((data) => {
        if (cancelled) return;
        const sorted = [...data].sort((a, b) => a.sort_order - b.sort_order);
        setItems(sorted);
        setOpenId(sorted[0]?.id ?? null);
      })
      .catch(() => {
        // landing FAQ is optional content — quietly hide the section on failure
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <Section id="faq" spacing="lg" className="border-t border-border bg-bg">
      <Container>
        <div className="mx-auto max-w-[640px] text-center">
          <Badge icon={<CircleHelp size={14} />}>Вопросы и ответы</Badge>
          <Heading as="h2" level="h1" className="mt-5">
            Возможно, вы <span className="text-accent">уже думаете об этом</span>
          </Heading>
          <Text size="lg" className="mx-auto mt-5 max-w-[42ch]">
            Если вопроса нет в списке — просто напишите нам в Telegram, ответим
            лично.
          </Text>
        </div>

        <div className="mx-auto mt-14 flex max-w-[720px] flex-col gap-3">
          {items.map((item, index) => {
            const isOpen = item.id === openId;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: ITEM_REVEAL_DISTANCE_PX }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: index * 0.05 }}
                className="overflow-hidden rounded-card border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4.5 text-left sm:px-6"
                >
                  <Text as="span" size="md" tone="primary" className="font-medium text-text">
                    {item.question}
                  </Text>
                  <ChevronDown
                    size={18}
                    className={cn(
                      "shrink-0 text-secondary transition-transform duration-300 ease-out-expo",
                      isOpen && "rotate-180 text-accent",
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <Text size="sm" className="px-5 pb-4.5 sm:px-6">
                        {item.answer}
                      </Text>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
