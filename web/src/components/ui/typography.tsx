import { createElement, type ElementType, type HTMLAttributes, type Ref } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const headingVariants = cva("font-display font-medium text-text text-balance", {
  variants: {
    level: {
      display:
        "text-[2rem] sm:text-[2.5rem] lg:text-[clamp(2.75rem,5.5vw,4.75rem)] leading-[1.1] lg:leading-[1.06] tracking-[-0.01em]",
      h1: "text-[1.75rem] sm:text-[2.25rem] lg:text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.15] lg:leading-[1.1] tracking-[-0.01em]",
      h2: "text-2xl sm:text-3xl lg:text-[clamp(1.875rem,3vw,2.75rem)] leading-[1.2] lg:leading-[1.14] tracking-[-0.005em]",
      h3: "text-2xl sm:text-3xl leading-snug",
      h4: "text-lg sm:text-xl leading-snug",
    },
  },
  defaultVariants: {
    level: "h2",
  },
});

export interface HeadingProps
  extends HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  as?: ElementType;
  ref?: Ref<HTMLHeadingElement>;
}

export function Heading({ className, level, as, ref, ...props }: HeadingProps) {
  return createElement(as ?? "h2", {
    ref,
    className: cn(headingVariants({ level }), className),
    ...props,
  });
}

const textVariants = cva("font-body", {
  variants: {
    size: {
      sm: "text-sm",
      md: "text-[15px] sm:text-base",
      lg: "text-lg sm:text-xl",
    },
    tone: {
      primary: "text-text",
      secondary: "text-secondary",
      accent: "text-accent",
    },
  },
  defaultVariants: {
    size: "md",
    tone: "secondary",
  },
});

export interface TextProps
  extends HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {
  as?: ElementType;
  ref?: Ref<HTMLParagraphElement>;
}

export function Text({ className, size, tone, as, ref, ...props }: TextProps) {
  return createElement(as ?? "p", {
    ref,
    className: cn(textVariants({ size, tone }), className),
    ...props,
  });
}
