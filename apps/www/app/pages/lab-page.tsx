import { Link, useParams } from "react-router";
import { DeadlineChip } from "~/components/custom/classes/deadline-chip";
import { Panel } from "~/components/custom/layout/panel";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { api, useApi } from "~/lib/api";

/**
 * /classes/:classId/labs/:labId — the per-lab management view (F6 shell).
 * Reads from the same /api/classes fetch as the hub (SWR-cached); the
 * acceptance roster and student lab repos arrive with F8 and fill the
 * placeholder section below.
 */
export function LabPage() {
  const { classId = "", labId = "" } = useParams();
  const { data, isLoading, error } = useApi(api.api.classes);

  const cls = data?.classes.find((c) => c.id === classId);
  const lab = cls?.labs.find((l) => l.id === labId);

  return (
    <Loading loading={isLoading} className="flex-1">
      {error || !cls || !lab ? (
        <Stack gap="lg" align="start" className="flex-1 pt-2">
          <Text variant="error">
            {error
              ? "Couldn't load this lab — refresh to retry."
              : "This lab doesn't exist (or you don't teach its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Stack>
      ) : (
        <Stack gap="lg" align="start" className="flex-1 pt-2">
          <Stack gap="sm">
            <Link
              to="/classes"
              className="text-muted-foreground text-sm hover:underline"
            >
              ‹ Classes / {cls.name ?? cls.login}
            </Link>
            <Row gap="sm" wrap>
              <Text variant="heading">{lab.title}</Text>
              <Badge variant="secondary" className="font-normal">
                {lab.groupMode === "individual"
                  ? "individual"
                  : `group ${lab.minMembers}–${lab.maxMembers}`}
              </Badge>
              <DeadlineChip deadline={new Date(lab.deadline)} />
            </Row>
          </Stack>

          <Panel>
            <Stack gap="sm">
              <Text variant="label" className="font-medium">
                Acceptance roster
              </Text>
              <Text variant="body2">
                Who accepted, their student lab repos, and group composition
                appear here once lab acceptance lands (F8).
              </Text>
            </Stack>
          </Panel>
        </Stack>
      )}
    </Loading>
  );
}
