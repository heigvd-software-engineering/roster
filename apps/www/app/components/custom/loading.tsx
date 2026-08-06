import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { cn } from "~/lib/utils";

type LoadingProps = {
  /** While true, the loading animation replaces the children. */
  loading: boolean;
  /** Optional caption under the animation (e.g. "Loading classes…"). */
  label?: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Wrap data-consuming components: shows a centered caption instead of the
 * children while their data is in flight. Words, not an animation: the wait
 * is short and a spinner says less than "Loading classes…" does.
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
      <output aria-label="Loading">
        <Text variant="body2" as="span">
          {label ?? "Loading…"}
        </Text>
      </output>
    </Stack>
  );
}
