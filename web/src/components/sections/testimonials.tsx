"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { MessageSquareQuote } from "lucide-react";
import { Badge, Card, Container, Heading, Section, Text } from "@/components/ui";
import { getLandingTestimonials, type TestimonialEntry } from "@/lib/api";
import ovaHeart from "@/assets/ova/ova-heart.png";

const CARD_REVEAL_DISTANCE_PX = 24;

function initialsFrom(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Testimonials() {
  const [items, setItems] = useState<TestimonialEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLandingTestimonials()
      .then((data) => {
        if (cancelled) return;
        setItems([...data].sort((a, b) => a.sort_order - b.sort_order));
      })
      .catch(() => {
        // no testimonials yet (or request failed) — placeholder card covers this
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section
      id="testimonials"
      spacing="lg"
      className="relative overflow-hidden border-t border-border bg-bg"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-0 hidden w-[65%] items-center justify-center lg:flex"
      >
        <div className="relative w-full">
          <div
            aria-hidden
            className="absolute inset-0 rounded-full bg-[radial-gradient(circle,var(--glow-accent-soft)_0%,transparent_70%)] blur-3xl"
          />
          <Image
            src={ovaHeart}
            alt=""
            className="mx-auto h-auto w-full max-w-[900px] select-none"
          />
        </div>
      </div>

      <Container className="relative z-10">
        <div className="text-center lg:text-right">
          <div className="relative mx-auto w-fit lg:hidden">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle,var(--glow-accent-soft)_0%,transparent_70%)] blur-2xl"
            />
            <Image
              src={ovaHeart}
              alt="OVA благодарит кухни, которые уже навели порядок"
              className="h-[clamp(140px,16vw,200px)] w-auto select-none"
            />
          </div>

          <Badge className="mt-4 lg:mt-0">Отзывы</Badge>
          <Heading as="h2" level="h1" className="mx-auto mt-5 lg:ml-auto lg:mr-0 lg:max-w-[18ch]">
            Кухни, которые уже <span className="text-accent">навели порядок</span>
          </Heading>
          <Text size="lg" className="mx-auto mt-5 max-w-[46ch] lg:ml-auto lg:mr-0">
            Рестораны, кофейни и кухонные сети, которые заменили тетради и
            разрозненные чаты одной системой.
          </Text>
        </div>

        {items.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: CARD_REVEAL_DISTANCE_PX }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-16 max-w-[480px]"
          >
            <Card padding="lg" className="flex flex-col items-center gap-4 border-dashed text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <MessageSquareQuote size={22} strokeWidth={2} />
              </span>
              <Heading as="h3" level="h4">
                Здесь мог бы быть ваш отзыв
              </Heading>
              <Text size="md" className="max-w-[34ch]">
                Мы только запускаемся — станьте одной из первых кухонь, которая
                расскажет о своём опыте с KitchenDesk.
              </Text>
            </Card>
          </motion.div>
        ) : (
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: CARD_REVEAL_DISTANCE_PX }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{
                  duration: 0.5,
                  ease: [0.16, 1, 0.3, 1],
                  delay: (index % 3) * 0.08,
                }}
              >
                <Card padding="lg" className="flex h-full flex-col gap-5 text-left">
                  <MessageSquareQuote size={20} strokeWidth={2} className="text-accent" />
                  <Text size="md" tone="primary" className="text-text">
                    {item.quote}
                  </Text>
                  <div className="mt-auto flex items-center gap-3 pt-2">
                    {item.avatar_url ? (
                      <Image
                        src={item.avatar_url}
                        alt={item.author_name}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
                        {initialsFrom(item.author_name)}
                      </span>
                    )}
                    <div>
                      <Text as="span" size="sm" tone="primary" className="block font-medium text-text">
                        {item.author_name}
                      </Text>
                      <Text as="span" size="sm" className="block">
                        {[item.author_role, item.restaurant_name].filter(Boolean).join(" · ")}
                      </Text>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
