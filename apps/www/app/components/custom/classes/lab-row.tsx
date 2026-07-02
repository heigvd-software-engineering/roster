import { DeadlineChip } from "~/components/custom/classes/deadline-chip";
import { Row } from "~/components/custom/layout/row";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import type { DummyLab } from "~/lib/dummy";

/** One lab inside a class card: title · mode · deadline · progress. */
export function LabRow({ lab }: { lab: DummyLab }) {
  const mode =
    lab.mode.kind === "individual"
      ? "individual"
      : `group ${lab.mode.min}–${lab.mode.max}`;

  return (
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
        <DeadlineChip deadline={lab.deadline} />
        <Text variant="body2">{lab.progress}</Text>
      </Row>
    </Row>
  );
}
