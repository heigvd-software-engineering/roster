import { Stack } from "~/components/custom/layout/stack";
import { cn } from "~/lib/utils";

/**
 * Page — the standard top-anchored page column under the app bar. One spacing
 * step (lg, 24px) rules the whole page: app bar → header, header → content,
 * and between sibling blocks (pass gap="lg" to nested lists too, e.g. cards).
 */
type PageProps = React.ComponentProps<typeof Stack>;

export function Page({ className, ...props }: PageProps) {
  return (
    <Stack
      gap="lg"
      align="start"
      className={cn("flex-1 pt-6", className)}
      {...props}
    />
  );
}
