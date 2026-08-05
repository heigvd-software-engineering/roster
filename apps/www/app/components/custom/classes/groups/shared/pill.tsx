import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

const TONE = {
  good: "bg-role-enrolled/10 text-role-enrolled",
  warn: "bg-warning/12 text-warning",
  bad: "bg-brand/10 text-brand",
  muted: "bg-foreground/6 text-muted-foreground",
} as const;
export type PillTone = keyof typeof TONE;

/** Dot + mono label pill, the group wall's verdict vocabulary, reused
 *  wherever a group needs a state at a glance (status chips, the attach menu,
 *  the reuse card's availability). */
export function Pill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        TONE[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
