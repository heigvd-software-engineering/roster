import { cn } from "~/lib/utils";

/**
 * Dashed ghost TILE — the "add action lives where the added thing will
 * appear" affordance (same family as the hub's connect card). A plain
 * button so it composes as a Base UI `render` target (dialog/menu trigger).
 */
export function GhostTile({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-28 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-border border-dashed px-4 py-4 text-center text-muted-foreground text-sm transition-colors hover:border-muted-foreground/60 hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
