import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * The one expand/collapse affordance in the app: a ghost chevron that rotates
 * to point at the state it will produce. Shared by the roster's group drawer
 * and the unassigned pool's student list, so the two read as the same verb.
 *
 * Icon-only — `label` is the accessible name and carries what's disclosed
 * ("Show all 12 students"), since the chevron alone says nothing.
 */
export function DisclosureToggle({
  expanded,
  onToggle,
  label,
  title,
  controls,
  size = "icon",
}: {
  expanded: boolean;
  onToggle: () => void;
  /** The accessible name; state-dependent ("Show all 12 students" / "Hide…"). */
  label: string;
  /** Hover text, when the label is too terse to explain the consequence. */
  title?: string;
  /** id of the region this controls — omit while that region is unmounted. */
  controls?: string;
  /** "icon-xs" fits inside compact rows (identity lists). */
  size?: "icon" | "icon-xs";
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={title ?? label}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          "size-4 text-muted-foreground transition-transform",
          size === "icon-xs" && "size-3.5",
          expanded && "rotate-180",
        )}
      />
    </Button>
  );
}
