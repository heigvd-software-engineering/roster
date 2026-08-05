import { Stack } from "~/components/custom/layout/stack";
import { cn } from "~/lib/utils";

/**
 * The standard top-anchored page column under the app bar. One spacing step
 * (lg, 24px) rules the page body: header → content and between sibling blocks
 * (pass gap="lg" to nested lists too, e.g. cards). The app bar gets a touch
 * more air (28px) so the page header doesn't hang off it.
 */
type PageProps = React.ComponentProps<typeof Stack>;

export function Page({ className, ...props }: PageProps) {
  return (
    <Stack
      gap="lg"
      align="start"
      className={cn("flex-1 pt-7", className)}
      {...props}
    />
  );
}
