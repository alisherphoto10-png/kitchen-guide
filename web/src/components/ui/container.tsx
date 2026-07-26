import type { HTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

export function Container({ className, ref, ...props }: ContainerProps) {
  return (
    <div
      ref={ref}
      className={cn("mx-auto w-full max-w-[1240px] px-6 sm:px-10", className)}
      {...props}
    />
  );
}
