"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button, Container, Heading, Section, Text } from "@/components/ui";
import { useRegisterModal } from "@/components/registration/register-modal-context";

export function Cta() {
  const { open } = useRegisterModal();

  return (
    <Section spacing="lg" className="border-t border-border bg-bg">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-card border border-border bg-card px-6 py-14 text-center sm:px-12 sm:py-20"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,var(--glow-accent-soft),transparent_70%)]"
          />
          <div className="relative">
            <Heading as="h2" level="h1" className="mx-auto max-w-[20ch]">
              Наведите порядок на кухне <span className="text-accent">уже сегодня</span>
            </Heading>
            <Text size="lg" className="mx-auto mt-5 max-w-[42ch]">
              Регистрация занимает пару минут — бот в Telegram сам создаст
              заведение и откроет доступ в веб-кабинет.
            </Text>
            <div className="mt-9 flex justify-center">
              <Button
                variant="primary"
                size="lg"
                icon={<ArrowRight size={18} />}
                iconPosition="right"
                onClick={open}
              >
                Начать бесплатно
              </Button>
            </div>
          </div>
        </motion.div>
      </Container>
    </Section>
  );
}
