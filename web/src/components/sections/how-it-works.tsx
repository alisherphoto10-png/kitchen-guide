"use client";

import { motion } from "framer-motion";
import { UserPlus, ListChecks, LayoutDashboard, type LucideIcon } from "lucide-react";
import { Badge, Container, Heading, Section, Text } from "@/components/ui";

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: UserPlus,
    title: "Регистрация",
    description:
      "Заполняете форму на сайте — бот в Telegram сам создаёт заведение и сразу открывает вход в веб-кабинет.",
  },
  {
    icon: ListChecks,
    title: "Мастер настройки",
    description:
      "6 шагов: цеха, сотрудники, ТТК, продукты, чек-листы. Любой можно пропустить и вернуться позже — ничего не потеряется.",
  },
  {
    icon: LayoutDashboard,
    title: "Работа каждый день",
    description:
      "Веб-кабинет и бот работают вместе: графики, уведомления и ТТК всегда под рукой у всей команды.",
  },
];

const STEP_REVEAL_DISTANCE_PX = 24;

export function HowItWorks() {
  return (
    <Section id="how-it-works" spacing="lg" className="bg-bg">
      <Container>
        <div className="text-center">
          <Badge>Как это работает</Badge>
          <Heading as="h2" level="h1" className="mt-5">
            От регистрации до первой смены — <span className="text-accent">три шага</span>
          </Heading>
          <Text size="lg" className="mx-auto mt-5 max-w-[42ch]">
            Никаких внедрений и обучения неделями — заведение готово к работе
            в день регистрации.
          </Text>
        </div>

        <div className="relative mt-16 grid gap-10 sm:grid-cols-3 sm:gap-6">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px bg-border sm:block"
          />
          {STEPS.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: STEP_REVEAL_DISTANCE_PX }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: index * 0.12 }}
              className="relative"
            >
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-accent">
                {index + 1}
              </div>
              <span className="mt-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <step.icon size={20} strokeWidth={2} />
              </span>
              <Heading as="h3" level="h4" className="mt-5">
                {step.title}
              </Heading>
              <Text size="sm" className="mt-2 max-w-[32ch]">
                {step.description}
              </Text>
            </motion.div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
