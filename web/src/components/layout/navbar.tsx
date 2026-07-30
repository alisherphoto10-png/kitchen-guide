"use client";

import { LogIn } from "lucide-react";
import { Logo } from "./logo";
import { Button, ButtonLink, Container } from "@/components/ui";
import { useRegisterModal } from "@/components/registration/register-modal-context";
import { LOGIN_URL } from "@/lib/api";

const NAV_LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#how-it-works", label: "Как это работает" },
  { href: "#testimonials", label: "Отзывы" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const { open } = useRegisterModal();

  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <Container>
        <nav className="flex h-20 items-center justify-between" aria-label="Основная навигация">
          <a href="#top" aria-label="KitchenDesk — на главную">
            <Logo />
          </a>

          <ul className="hidden items-center gap-8 text-sm text-secondary lg:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="transition-colors duration-200 hover:text-text"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3">
            <ButtonLink href={LOGIN_URL} variant="ghost" size="sm" icon={<LogIn size={16} />}>
              Войти
            </ButtonLink>
            <Button variant="primary" size="sm" onClick={open}>
              Создать заведение
            </Button>
          </div>
        </nav>
      </Container>
    </header>
  );
}
