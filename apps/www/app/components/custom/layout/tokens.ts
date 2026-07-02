/**
 * Shared spacing scale for the layout primitives. Only the steps currently in
 * use are listed — add more as screens need them. Values MUST be static literal
 * class strings (never `gap-${x}`); Tailwind only generates classes it sees.
 */
export const GAP = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
} as const;
export type Gap = keyof typeof GAP;

export const ALIGN = {
  start: "items-start",
  center: "items-center",
} as const;
export type Align = keyof typeof ALIGN;

export const JUSTIFY = {
  center: "justify-center",
  between: "justify-between",
} as const;
export type Justify = keyof typeof JUSTIFY;
