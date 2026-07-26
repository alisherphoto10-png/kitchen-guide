"use client";

import { motion } from "framer-motion";
import {
  CalendarClock,
  ClipboardList,
  Scissors,
  ShieldCheck,
  BellRing,
  Send,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card, Container, Heading, Section, Text } from "@/components/ui";

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

const CARD_REVEAL_DISTANCE_PX = 24;

export function Features() {
  return (
    <Section id="features" spacing="lg" className="bg-bg">
      <Container>
        <div className="text-center">
          <Badge>Возможности</Badge>
          <Heading as="h2" level="h1" className="mt-5">
            Всё, что нужно кухне — в <span className="text-accent">одном месте</span>
          </Heading>
          <Text size="lg" className="mx-auto mt-5 max-w-[38ch]">
            KitchenDesk заменяет тетради, разрозненные чаты и Excel-файлы одной
            системой, которая знает, кто сегодня дежурит и что происходит на кухне.
          </Text>
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
