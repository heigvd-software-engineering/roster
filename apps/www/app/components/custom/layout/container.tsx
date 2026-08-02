import { cn } from "~/lib/utils";

/** Horizontally-centered content column with responsive padding. */
type ContainerProps = React.ComponentProps<"div">;

export function Container({ className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-5xl px-6 md:px-10", className)}
      {...props}
    />
  );
}
