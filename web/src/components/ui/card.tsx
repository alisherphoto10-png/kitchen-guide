import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-card border border-border bg-card", {
  variants: {
    padding: {
      none: "p-0",
      sm: "p-5",
      md: "p-6 sm:p-8",
      lg: "p-8 sm:p-10",
    },
    interactive: {
      true: "transition-colors duration-200 ease-out-expo hover:border-secondary/40",
      false: "",
    },
  },
  defaultVariants: {
    padding: "md",
    interactive: false,
  },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ padding, interactive }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";
