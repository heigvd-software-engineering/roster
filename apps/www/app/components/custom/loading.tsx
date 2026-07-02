import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { cn } from "~/lib/utils";

type LoadingProps = {
  /** While true, the children are replaced by the loading animation. */
  loading: boolean;
  /** Optional caption under the animation (e.g. "Loading classes…"). */
  label?: string;
  className?: string;
  children?: React.ReactNode;
};

/** Three staggered black bars — a Swiss equalizer pulse. */
function Bars() {
  return (
    <output aria-label="Loading" className="flex h-6 items-end gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="loader-bar h-6 w-1.5 origin-bottom bg-foreground"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </output>
  );
}

/**
 * Wrap data-consuming components: renders a centered loading animation instead
 * of the children while their data is in flight.
 *
 *   <Loading loading={isLoading} label="Loading classes…">
 *     <ClassList … />
 *   </Loading>
 */
export function Loading({ loading, label, className, children }: LoadingProps) {
  if (!loading) {
    return <>{children}</>;
  }
  return (
    <Stack
      gap="sm"
      align="center"
      justify="center"
      className={cn("w-full py-12", className)}
    >
      <Bars />
      {label ? <Text variant="body2">{label}</Text> : null}
    </Stack>
  );
}
