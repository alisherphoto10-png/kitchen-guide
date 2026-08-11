import { Send } from "lucide-react";
import { Logo } from "./logo";
import { Container, Text } from "@/components/ui";
import { LOGIN_URL, TELEGRAM_BOT_URL } from "@/lib/api";

const NAV_LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#how-it-works", label: "Как это работает" },
  { href: "#testimonials", label: "Отзывы" },
  { href: "#faq", label: "FAQ" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-bg">
      <Container className="flex flex-col gap-10 py-14 sm:py-16">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <a href="#top" aria-label="KitchenDesk — на главную">
            <Logo />
          </a>

          <ul className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-secondary">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="transition-colors duration-200 hover:text-text">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-secondary transition-colors duration-200 hover:text-text"
          >
            <Send size={16} />
            Написать в Telegram
          </a>
        </div>

        <div className="flex flex-col items-start justify-between gap-4 border-t border-border pt-8 text-sm text-secondary sm:flex-row sm:items-center">
          <Text size="sm">© {year} KitchenDesk. Все права защищены.</Text>
          <a href={LOGIN_URL} className="transition-colors duration-200 hover:text-text">
            Вход в веб-кабинет
          </a>
        </div>
      </Container>
    </footer>
  );
}
