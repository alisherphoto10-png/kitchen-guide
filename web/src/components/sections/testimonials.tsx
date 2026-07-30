"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Badge, Card, Container, Heading, Section, Text } from "@/components/ui";
import ovaHeart from "@/assets/ova/ova-heart.png";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  place: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "Раньше график дежурств жил в трёх разных чатах. Теперь всё в одном месте, и никто не путает смены.",
    name: "Дмитрий Волков",
    role: "Шеф-повар",
    place: "ресторан «Библиотека», Москва",
  },
  {
    quote:
      "ТТК с пересчётом на нужный выход экономит час каждый день — раньше пересчитывал вручную в блокноте.",
    name: "Анна Кравцова",
    role: "Управляющая",
    place: "кофейня-кухня «Зёрна», Санкт-Петербург",
  },
  {
    quote:
      "Акты разделки теперь проходят согласование за пару кликов — раньше это был день беготни по кухне.",
    name: "Марат Ахметов",
    role: "Су-шеф",
    place: "сеть «Плов Хаус», Казань",
  },
  {
    quote:
      "Уведомления настроены именно так, как нужно нам — никто больше не забывает про просроченные акты.",
    name: "Ольга Смирнова",
    role: "Директор",
    place: "ресторан «Терраса», Сочи",
  },
  {
    quote:
      "Роли и доступ разделили как надо — каждый видит только своё, а я вижу всё сразу в одном кабинете.",
    name: "Игорь Литвинов",
    role: "Шеф-повар",
    place: "гастробар «Дым», Екатеринбург",
  },
  {
    quote:
      "Telegram-бот держит смену в курсе на бегу, веб-кабинет — для меня и отчётов. Синхронизация идеальная.",
    name: "Екатерина Белова",
    role: "Управляющая",
    place: "пекарня-кухня «Крошка», Новосибирск",
  },
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

const CARD_REVEAL_DISTANCE_PX = 24;

export function Testimonials() {
  return (
    <Section id="testimonials" spacing="lg" className="border-t border-border bg-bg">
      <Container>
        <div className="text-center">
          <div className="relative mx-auto w-fit">
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

          <Badge className="mt-4">Отзывы</Badge>
          <Heading as="h2" level="h1" className="mt-5">
            Кухни, которые уже <span className="text-accent">навели порядок</span>
          </Heading>
          <Text size="lg" className="mx-auto mt-5 max-w-[46ch]">
            Рестораны, кофейни и кухонные сети, которые заменили тетради и
            разрозненные чаты одной системой.
          </Text>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: CARD_REVEAL_DISTANCE_PX }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: (index % 3) * 0.08 }}
            >
              <Card className="flex h-full flex-col">
                <Text size="md" tone="primary" className="flex-1 leading-relaxed">
                  «{testimonial.quote}»
                </Text>
                <div className="mt-6 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
                    {initialsOf(testimonial.name)}
                  </span>
                  <div>
                    <Text size="sm" tone="primary" className="font-medium">
                      {testimonial.name}
                    </Text>
                    <Text size="sm" className="mt-0.5">
                      {testimonial.role} · {testimonial.place}
                    </Text>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
