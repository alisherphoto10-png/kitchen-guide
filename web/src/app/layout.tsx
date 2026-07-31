import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Unbounded, Inter } from "next/font/google";
import { SmoothScrollProvider } from "@/components/providers/smooth-scroll-provider";
import { RegisterModalProvider } from "@/components/registration/register-modal-context";
import { RegisterModal } from "@/components/registration/register-modal";
import { TelegramAutoRedirect } from "@/components/telegram/telegram-auto-redirect";
import "./globals.css";

const displayFont = Unbounded({
  variable: "--font-display-raw",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const bodyFont = Inter({
  variable: "--font-body-raw",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "KitchenDesk — операционная система для вашей кухни",
  description:
    "KitchenDesk — AI-платформа управления кухней для рестораторов, шеф-поваров и сетей: графики, ТТК, акты разделки и контроль в одном месте.",
};

export const viewport: Viewport = {
  themeColor: "#040816",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${displayFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-text font-body">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramAutoRedirect />
        <RegisterModalProvider>
          <SmoothScrollProvider>{children}</SmoothScrollProvider>
          <RegisterModal />
        </RegisterModalProvider>
      </body>
    </html>
  );
}
