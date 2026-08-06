import { cn } from "~/lib/utils";

/**
 * The single typography component. `variant` picks the visual style and a
 * sensible default element (heading variants render <h1>/<h2>, the rest <p>).
 * Pass `as`, like MUI's `component` prop, to render on a different element
 * when a variant's default doesn't fit the context, say because a <p> isn't
 * valid inside a <button>.
 *
 *   title     page/screen heading (h1)      subtitle  muted intro paragraph
 *   heading   section heading (h2)          body1     primary body text
 *   label     small foreground label        body2     secondary (smaller, muted)
 *   caption   small muted caption           error     small destructive message
 */
const VARIANT = {
  title: "text-3xl font-semibold tracking-tight",
  heading: "text-xl font-semibold tracking-tight",
  subtitle: "text-base text-muted-foreground",
  body1: "text-base text-foreground",
  body2: "text-sm text-muted-foreground",
  label: "text-sm text-foreground",
  caption: "text-xs text-muted-foreground",
  error: "text-sm text-destructive",
} as const;

const ELEMENT = {
  title: "h1",
  heading: "h2",
  subtitle: "p",
  body1: "p",
  body2: "p",
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
