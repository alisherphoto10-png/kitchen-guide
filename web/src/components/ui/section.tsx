import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const sectionVariants = cva("relative w-full", {
  variants: {
    spacing: {
      none: "py-0",
      sm: "py-16 sm:py-20",
      md: "py-24 sm:py-32",
      lg: "py-32 sm:py-40",
    },
  },
  defaultVariants: {
    spacing: "md",
  },
});

export interface SectionProps
  extends HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {}

export function Section({ className, spacing, id, ...props }: SectionProps) {
  return (
    <section id={id} className={cn(sectionVariants({ spacing }), className)} {...props} />
  );
}
