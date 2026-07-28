"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  ClipboardList,
  Scissors,
  ShieldCheck,
  BellRing,
  Send,
  BarChart3,
  FileText,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card, Container, Heading, Section, Text } from "@/components/ui";
import ovaPointing from "@/assets/ova/ova-pointing.png";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: CalendarClock,
    title: "График дежурств",
    description:
      "Уборка и питание — раздельные графики. Загрузка из Excel, а уведомления сотрудникам объединяются в одно сообщение, даже если он дежурит в обоих.",
  },
  {
    icon: ClipboardList,
    title: "Технологические карты",
    description:
      "ТТК с калькулятором пересчёта состава на нужный выход и экспортом в PDF/Excel с фото блюда — бренд-версия для проверок и поставщиков.",
  },
  {
    icon: Scissors,
    title: "Акты разделки",
    description:
      "Автоподсчёт отхода, согласование по статусам (на проверке / принят / на доработку) и история правок по каждому акту.",
  },
  {
    icon: ShieldCheck,
    title: "Роли и доступ",
    description:
      "У шефа, су-шефа и повара — разные права на каждый раздел. Рестораны в сети изолированы друг от друга без утечек данных.",
  },
  {
    icon: BellRing,
    title: "Уведомления под контролем",
    description:
      "19 типов событий, каждое включается и настраивается по времени отдельно — от смены дежурства до просроченного акта.",
  },
  {
    icon: Send,
    title: "Telegram и веб — как удобно",
    description:
      "Бот держит смену в курсе на бегу, веб-кабинет — для управления и отчётов. Один аккаунт, данные всегда синхронны.",
  },
];

interface FloatingChip {
  icon: LucideIcon;
  label: string;
  className: string;
  floatDuration: number;
  floatDelay: number;
}

const FLOATING_CHIPS: FloatingChip[] = [
  {
    icon: BarChart3,
    label: "График дежурств",
    className: "left-[-30%] top-[2%]",
    floatDuration: 5.5,
    floatDelay: 0,
  },
  {
    icon: FileText,
    label: "ТТК",
    className: "right-[-24%] top-[-4%]",
    floatDuration: 4.8,
    floatDelay: 0.4,
  },
  {
    icon: Scissors,
    label: "Акты разделки",
    className: "right-[-32%] top-[52%]",
    floatDuration: 6.2,
    floatDelay: 0.9,
  },
  {
    icon: CheckCircle2,
    label: "Готово",
    className: "left-[-22%] bottom-[8%]",
    floatDuration: 5,
    floatDelay: 1.3,
  },
];

const CARD_REVEAL_DISTANCE_PX = 24;

export function Features() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <Section
      id="features"
      spacing="lg"
      className="relative overflow-hidden border-t border-border bg-bg"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[linear-gradient(to_bottom,var(--glow-accent-soft),transparent)] opacity-40"
      />
      <Container className="relative">
        <div className="grid items-center gap-16 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="relative mx-auto w-fit">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle,var(--glow-accent-soft)_0%,transparent_70%)] blur-2xl"
            />
            <Image
              src={ovaPointing}
              alt="OVA показывает на возможности KitchenDesk"
              className="h-[clamp(280px,34vw,420px)] w-auto select-none"
            />
            {FLOATING_CHIPS.map((chip) => (
              <motion.div
                key={chip.label}
                className={`absolute hidden items-center gap-2 rounded-xl border border-border bg-card/90 px-3.5 py-2.5 text-xs font-medium text-text shadow-[0_16px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur sm:flex ${chip.className}`}
                animate={prefersReducedMotion ? undefined : { y: [0, -12, 0] }}
                transition={
                  prefersReducedMotion
                    ? undefined
                    : {
                        duration: chip.floatDuration,
                        delay: chip.floatDelay,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }
                }
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <chip.icon size={14} strokeWidth={2} />
                </span>
                {chip.label}
              </motion.div>
            ))}
          </div>

          <div>
            <Badge>Возможности</Badge>
            <Heading as="h2" level="h1" className="mt-5">
              Всё, что нужно кухне — в <span className="text-accent">одном месте</span>
            </Heading>
            <Text size="lg" className="mt-5 max-w-[42ch]">
              KitchenDesk заменяет тетради, разрозненные чаты и Excel-файлы одной
              системой, которая знает, кто сегодня дежурит и что происходит на кухне.
            </Text>
          </div>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: CARD_REVEAL_DISTANCE_PX }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: (index % 3) * 0.08 }}
            >
              <Card interactive className="h-full">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <feature.icon size={20} strokeWidth={2} />
                </span>
                <Heading as="h3" level="h4" className="mt-5">
                  {feature.title}
                </Heading>
                <Text size="sm" className="mt-2">
                  {feature.description}
                </Text>
              </Card>
            </motion.div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
