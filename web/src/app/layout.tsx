import type { Metadata, Viewport } from "next";
import { Unbounded, Inter } from "next/font/google";
import { SmoothScrollProvider } from "@/components/providers/smooth-scroll-provider";
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
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
      </body>
    </html>
  );
}
