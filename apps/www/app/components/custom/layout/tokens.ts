/**
 * Shared spacing scale for the layout primitives. Only the steps currently in
 * use are listed, so add more as screens need them. Values MUST be static
 * literal class strings, never `gap-${x}`: Tailwind generates what it sees.
 */
export const GAP = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
} as const;
export type Gap = keyof typeof GAP;

export const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
} as const;
export type Align = keyof typeof ALIGN;

export const JUSTIFY = {
  center: "justify-center",
  between: "justify-between",
} as const;
export type Justify = keyof typeof JUSTIFY;
