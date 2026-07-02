import { cn } from "~/lib/utils";
import {
  ALIGN,
  type Align,
  GAP,
  type Gap,
  JUSTIFY,
  type Justify,
} from "./tokens";

/** Vertical flex column with a standardized gap. (≈ MUI `<Stack>`.) */
type StackProps = React.ComponentProps<"div"> & {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
};

export function Stack({
  gap = "md",
  align,
  justify,
  className,
  ...props
}: StackProps) {
  return (
    <div
      className={cn(
        "flex flex-col",
        GAP[gap],
        align && ALIGN[align],
        justify && JUSTIFY[justify],
        className,
      )}
      {...props}
    />
  );
}
