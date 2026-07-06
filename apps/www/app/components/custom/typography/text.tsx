import { cn } from "~/lib/utils";

/**
 * Text — the single typography component. `variant` picks the visual style and
 * a sensible default element (heading variants render <h1>/<h2>, the rest <p>).
 * Pass `as` to render on a different element when a variant's default doesn't
 * fit the context (e.g. a <p> isn't valid inside a <button>) — like MUI's
 * `component` prop.
 *
 *   hero      landing wordmark              subtitle  muted intro paragraph
 *   title     in-app page/screen heading    overline  small mono uppercase label
 *   body1     primary body text             body2     secondary (smaller, muted)
 *   heading   section heading (h2)          label     small foreground label
 *   caption   small muted caption           error     small destructive message
 */
const VARIANT = {
  hero: "text-7xl font-bold tracking-tight md:text-8xl",
  title: "text-4xl font-bold tracking-tight md:text-5xl",
  subtitle: "text-lg text-muted-foreground",
  overline:
    "font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground",
  body1: "text-base text-foreground",
  body2: "text-sm text-muted-foreground",
  heading: "text-2xl font-bold tracking-tight",
  label: "text-sm text-foreground",
  caption: "text-xs text-muted-foreground",
  error: "text-sm text-destructive",
} as const;

const ELEMENT = {
  hero: "h1",
  title: "h1",
  subtitle: "p",
  overline: "p",
  body1: "p",
  body2: "p",
  heading: "h2",
  label: "p",
  caption: "p",
  error: "p",
} as const;

type Variant = keyof typeof VARIANT;

type TextProps = React.HTMLAttributes<HTMLElement> & {
  variant?: Variant;
  as?: React.ElementType;
};

export function Text({
  variant = "body1",
  as,
  className,
  ...props
}: TextProps) {
  const Tag = as ?? (ELEMENT[variant] as React.ElementType);
  return <Tag className={cn(VARIANT[variant], className)} {...props} />;
}
