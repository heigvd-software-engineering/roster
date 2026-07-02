import { cn } from "~/lib/utils";

/**
 * Text — the single typography component. `variant` picks the visual style and
 * a sensible default element (heading variants render <h1>, the rest <p>).
 * If a screen ever needs a variant on a different element, we add an `as`
 * override then (like MUI's `component` prop).
 *
 *   hero      landing wordmark              subtitle  muted intro paragraph
 *   title     in-app page/screen heading    overline  small mono uppercase label
 *   body1     primary body text             body2     secondary (smaller, muted)
 */
const VARIANT = {
  hero: "text-7xl font-bold tracking-tight md:text-8xl",
  title: "text-4xl font-bold tracking-tight md:text-5xl",
  subtitle: "text-lg text-muted-foreground",
  overline:
    "font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground",
  body1: "text-base text-foreground",
  body2: "text-sm text-muted-foreground",
} as const;

const ELEMENT = {
  hero: "h1",
  title: "h1",
  subtitle: "p",
  overline: "p",
  body1: "p",
  body2: "p",
} as const;

type Variant = keyof typeof VARIANT;

type TextProps = React.HTMLAttributes<HTMLElement> & {
  variant?: Variant;
};

export function Text({ variant = "body1", className, ...props }: TextProps) {
  const Tag = ELEMENT[variant] as React.ElementType;
  return <Tag className={cn(VARIANT[variant], className)} {...props} />;
}
