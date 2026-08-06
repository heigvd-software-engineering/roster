import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "~/components/ui/button";

/**
 * The one expand/collapse affordance in the app: a ghost chevron pointing at
 * the state it will produce. Shared by the roster's group drawer and the
 * unassigned pool's student list, so the two read as the same verb.
 *
 * Icon-only, so `label` is the accessible name and carries what's disclosed
 * ("Show all 12 students"): the chevron alone says nothing.
 */
export function DisclosureToggle({
  expanded,
  onToggle,
  label,
  title,
  controls,
}: {
  expanded: boolean;
  onToggle: () => void;
  /** The accessible name; state-dependent ("Show all 12 students" / "Hide…"). */
  label: string;
  /** Hover text, when the label is too terse to explain the consequence. */
  title?: string;
  /** id of the region this controls. Omit while that region is unmounted. */
  controls?: string | undefined;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={title ?? label}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronUp className="size-4 text-muted-foreground" />
      ) : (
        <ChevronDown className="size-4 text-muted-foreground" />
      )}
    </Button>
  );
}
