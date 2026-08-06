import { Badge } from "~/components/ui/badge";

/** Which side of a class the caller is on. */
export type Role = "teaching" | "enrolled";

/** The role badge for a class card or lab header. The prop is `kind`, not
 *  `role`, because a `role` prop trips a11y linting as an ARIA role
 *  attribute. */
export function RoleChip({ kind }: { kind: Role }) {
  return <Badge variant="secondary">{kind}</Badge>;
}
