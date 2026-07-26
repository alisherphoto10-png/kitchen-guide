import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display font-medium", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent to-accent-deep">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M12 2 21 7v10l-9 5-9-5V7l9-5Z"
            stroke="#040816"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="#040816" />
        </svg>
      </span>
      <span className="text-[19px] tracking-[-0.01em] text-text">KitchenDesk</span>
    </span>
  );
}
