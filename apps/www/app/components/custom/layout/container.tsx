import { cn } from "~/lib/utils";

/** Horizontally-centered content column with responsive padding. `wide`
 *  relaxes the cap for pages whose content is a grid that earns the width
 *  (the lab wall: ~12 group cards want 2 rows, not 3) — text pages keep
 *  the readable 5xl column. */
type ContainerProps = React.ComponentProps<"div"> & { wide?: boolean };

export function Container({
  wide = false,
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-6 md:px-10",
        wide ? "max-w-[100rem]" : "max-w-5xl",
        className,
      )}
      {...props}
    />
  );
}
