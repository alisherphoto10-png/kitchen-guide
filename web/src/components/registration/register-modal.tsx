"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, Send, X } from "lucide-react";
import { Button, ButtonLink, Heading, Text } from "@/components/ui";
import { useRegisterModal } from "./register-modal-context";
import {
  ApiError,
  LOGIN_URL,
  TELEGRAM_BOT_URL,
  getRegisterStatus,
  registerLanding,
} from "@/lib/api";

const POLL_INTERVAL_MS = 4000;

type Step = "form" | "pending" | "done";

export function RegisterModal() {
  const { isOpen, close } = useRegisterModal();
  const [step, setStep] = useState<Step>("form");
  const [restaurantName, setRestaurantName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) return;
    const resetTimeout = setTimeout(() => {
      setStep("form");
      setRestaurantName("");
      setName("");
      setPhone("");
      setError(null);
      setToken(null);
    }, 300);
    return () => clearTimeout(resetTimeout);
  }, [isOpen]);

  useEffect(() => {
    if (step !== "pending" || !token) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const { status } = await getRegisterStatus(token);
        if (cancelled || status !== "completed") return;
        setStep("done");
        window.location.href = LOGIN_URL;
      } catch {
        // transient poll error, keep trying
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedRestaurant = restaurantName.trim();
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedRestaurant || !trimmedName || !trimmedPhone) {
      setError("Укажите название заведения, имя и телефон");
      return;
    }

    setIsSubmitting(true);
    try {
      const { token: newToken } = await registerLanding({
        restaurant_name: trimmedRestaurant,
        name: trimmedName,
        phone: trimmedPhone,
      });
      setToken(newToken);
      setStep("pending");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось отправить заявку. Попробуйте ещё раз.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
            onClick={close}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-modal-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[440px] rounded-card border border-border bg-card p-6 shadow-[0_32px_64px_-24px_rgba(0,0,0,0.6)] sm:p-8"
          >
            <button
              type="button"
              onClick={close}
              aria-label="Закрыть"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-secondary transition-colors hover:bg-white/[0.05] hover:text-text"
            >
              <X size={18} />
            </button>

            {step === "form" && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <Heading as="h3" level="h4" id="register-modal-title">
                    Создать заведение
                  </Heading>
                  <Text size="sm" className="mt-2">
                    Оставьте заявку — бот в Telegram проведёт вас через регистрацию за пару
                    минут.
                  </Text>
                </div>

                <label className="flex flex-col gap-1.5 text-sm text-secondary">
                  Название заведения
                  <input
                    value={restaurantName}
                    onChange={(event) => setRestaurantName(event.target.value)}
                    placeholder="Например, «Терраса»"
                    className="h-11 rounded-control border border-border bg-white/[0.02] px-3.5 text-[15px] text-text placeholder:text-secondary/60 focus:border-accent/50 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm text-secondary">
                  Ваше имя
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Имя"
                    className="h-11 rounded-control border border-border bg-white/[0.02] px-3.5 text-[15px] text-text placeholder:text-secondary/60 focus:border-accent/50 focus:outline-none"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm text-secondary">
                  Телефон
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    type="tel"
                    placeholder="+998 90 123 45 67"
                    className="h-11 rounded-control border border-border bg-white/[0.02] px-3.5 text-[15px] text-text placeholder:text-secondary/60 focus:border-accent/50 focus:outline-none"
                  />
                </label>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-red-400">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isSubmitting}
                  className="mt-2"
                  icon={isSubmitting ? <Loader2 size={18} className="animate-spin" /> : undefined}
                >
                  {isSubmitting ? "Отправляем..." : "Отправить заявку"}
                </Button>
              </form>
            )}

            {step === "pending" && token && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Send size={22} />
                </span>
                <div>
                  <Heading as="h3" level="h4" id="register-modal-title">
                    Продолжите в Telegram
                  </Heading>
                  <Text size="sm" className="mx-auto mt-2 max-w-[32ch]">
                    Заявка принята. Откройте бота — он завершит создание заведения и пришлёт
                    доступ в веб-кабинет.
                  </Text>
                </div>
                <ButtonLink
                  href={`${TELEGRAM_BOT_URL}?start=reg_${token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="primary"
                  size="lg"
                  icon={<Send size={18} />}
                >
                  Продолжить в Telegram
                </ButtonLink>
                <Text size="sm" className="flex items-center gap-2 text-secondary">
                  <Loader2 size={14} className="animate-spin" />
                  Ждём завершения регистрации в боте…
                </Text>
              </div>
            )}

            {step === "done" && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <CheckCircle2 size={22} />
                </span>
                <Heading as="h3" level="h4" id="register-modal-title">
                  Готово!
                </Heading>
                <Text size="sm">Переходим в веб-кабинет…</Text>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
