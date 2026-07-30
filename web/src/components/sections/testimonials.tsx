"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { MessageSquareQuote } from "lucide-react";
import { Badge, Card, Container, Heading, Section, Text } from "@/components/ui";
import ovaHeart from "@/assets/ova/ova-heart.png";

const CARD_REVEAL_DISTANCE_PX = 24;

export function Testimonials() {
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
      </Container>
    </Section>
  );
}
