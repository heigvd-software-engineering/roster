import { Link } from "react-router";
import { DeadlineChip } from "~/components/custom/classes/deadline-chip";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import type { LabItem } from "~/lib/api";

/** One lab inside a class card: title · mode · deadline · progress. The row
 *  links to the lab detail page (the app's drill-down unit). Progress shows
 *  `—` until acceptance exists (F8). */
export function LabRow({ lab }: { lab: LabItem }) {
  const mode =
    lab.groupMode === "individual"
      ? "individual"
      : `group ${lab.minMembers}–${lab.maxMembers}`;

  return (
    <Link
      to={`/classes/${lab.classId}/labs/${lab.id}`}
      className="-mx-2 block rounded-md px-2 transition-colors hover:bg-muted/60"
    >
      <Row
        justify="between"
        wrap
        className="w-full border-border border-t py-2 first:border-t-0"
      >
        <Row gap="sm">
          <Text variant="body1">{lab.title}</Text>
          <Badge variant="secondary" className="font-normal">
            {mode}
          </Badge>
        </Row>
        <Row gap="sm">
          <DeadlineChip deadline={new Date(lab.deadline)} />
          <Text variant="body2">—</Text>
        </Row>
      </Row>
    </Link>
  );
}
