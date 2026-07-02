import { cn } from "~/lib/utils";
import {
  ALIGN,
  type Align,
  GAP,
  type Gap,
  JUSTIFY,
  type Justify,
} from "./tokens";

/** Horizontal flex row with a standardized gap. (≈ MUI `<Stack direction="row">`.) */
type RowProps = React.ComponentProps<"div"> & {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
};

export function Row({
  gap = "md",
  align = "center",
  justify,
  wrap = false,
  className,
  ...props
}: RowProps) {
  return (
    <div
      className={cn(
        "flex flex-row",
        wrap && "flex-wrap",
        GAP[gap],
        ALIGN[align],
        justify && JUSTIFY[justify],
        className,
      )}
      {...props}
    />
  );
}
