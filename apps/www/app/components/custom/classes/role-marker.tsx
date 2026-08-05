import { cn } from "~/lib/utils";

/**
 * The hub's role marker: every class card carries a colored left SPINE
 * (scannable at any scroll speed) + a mono chip naming the caller's role.
 * Role hues are identity, not state: urgency stays brand red. Static class
 * literals only, since Tailwind generates what it sees.
 */
const ROLE = {
  teaching: {
    spine:
      "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-role-teaching",
    chip: "border-role-teaching/25 bg-role-teaching/10 text-role-teaching",
    label: "teaching",
  },
  enrolled: {
    spine:
      "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-role-enrolled",
    chip: "border-role-enrolled/25 bg-role-enrolled/10 text-role-enrolled",
    label: "enrolled",
  },
} as const;

export type Role = keyof typeof ROLE;

/** Card className fragment: the colored left spine. Needs the card's
 *  overflow-hidden to clip to the rounded corners. */
export function roleSpine(role: Role) {
  return ROLE[role].spine;
}

/** The mono role chip for the card header. The prop is `kind`, not `role`,
 *  because a `role` prop trips a11y linting as an ARIA role attribute. */
export function RoleChip({ kind }: { kind: Role }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        ROLE[kind].chip,
      )}
    >
      {ROLE[kind].label}
    </span>
  );
}
