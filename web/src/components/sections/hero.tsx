"use client";

import { useRef } from "react";
import { ChevronDown, Sparkles as SparklesIcon, ArrowRight, PlayCircle } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { Badge, Button, ButtonLink, Container, Heading, Text } from "@/components/ui";
import { OvaMascot } from "@/components/ova/ova-mascot";
import { OvaSceneLoader } from "@/components/ova/ova-scene-loader";
import { useRegisterModal } from "@/components/registration/register-modal-context";

export function Hero() {
  const { open } = useRegisterModal();
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copyRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const scrollCueRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const entrance = gsap.timeline({ defaults: { ease: "power3.out" } });

      entrance
        .fromTo(badgeRef.current, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 })
        .fromTo(
          headingRef.current,
          { y: 28, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.75 },
          "-=0.4",
        )
        .fromTo(
          copyRef.current,
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.65 },
          "-=0.5",
        )
        .fromTo(
          Array.from(ctaRef.current?.children ?? []),
          { y: 16, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.55, stagger: 0.1 },
          "-=0.4",
        );

      gsap.to(innerRef.current, {
        yPercent: -10,
        opacity: 0.35,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });

      gsap.to(scrollCueRef.current, {
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "12% top",
          scrub: true,
        },
      });

      return () => {
        ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      };
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative flex min-h-[100svh] items-center overflow-hidden bg-bg pt-28 pb-16 lg:pt-20 lg:pb-0"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--glow-accent-soft),transparent_70%)]"
      />

      <Container className="relative z-10" ref={innerRef}>
        <div className="grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
          <div>
            <div ref={badgeRef}>
              <Badge icon={<SparklesIcon size={14} />}>AI для вашей кухни</Badge>
            </div>

            <Heading
              as="h1"
              level="display"
              ref={headingRef}
              className="mt-6 lg:max-w-[16ch]"
            >
              Операционная система для <span className="text-accent">вашей кухни</span>
            </Heading>

            <Text as="p" size="lg" ref={copyRef} className="mt-6 max-w-[46ch]">
              Графики дежурств, технологические карты, акты разделки и контроль
              смены — всё в одном месте. KitchenDesk наводит порядок там, где
              обычно царит хаос.
            </Text>

            <div ref={ctaRef} className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                variant="primary"
                size="lg"
                icon={<ArrowRight size={18} />}
                iconPosition="right"
                onClick={open}
              >
                Начать бесплатно
              </Button>
              <ButtonLink href="#how-it-works" variant="outline" size="lg" icon={<PlayCircle size={18} />}>
                Смотреть демо
              </ButtonLink>
            </div>
          </div>

          <div className="relative mx-auto aspect-square w-full max-w-[620px]">
            <OvaSceneLoader />
            <div className="relative flex h-full items-center justify-center">
              <OvaMascot />
            </div>
          </div>
        </div>
      </Container>

      <div
        ref={scrollCueRef}
        className="absolute inset-x-0 bottom-8 z-10 flex flex-col items-center gap-2 text-secondary"
      >
        <span className="text-xs tracking-[0.08em] uppercase">Листайте вниз</span>
        <ChevronDown size={18} className="animate-bounce" />
      </div>
    </section>
  );
}
