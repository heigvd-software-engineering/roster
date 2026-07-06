import { Check } from "lucide-react";
import { Link, useParams } from "react-router";
import { DeadlineText } from "~/components/custom/classes/deadline-text";
import { LabGroupsSection } from "~/components/custom/classes/lab-groups-section";
import { RoleChip } from "~/components/custom/classes/role-marker";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import { api, type LabItem, labGroupsApi, useAction, useApi } from "~/lib/api";
import { formatDeadline, labModeLabel } from "~/lib/format";

/**
 * /classes/:classId/labs/:labId — the lab page, BOTH roles: teachers manage
 * the participating groups; students accept the lab here (one click on
 * individual labs, group machinery on group labs). Reads from the same
 * /api/classes fetch as the hub (SWR-cached).
 */
export function LabPage() {
  const { classId = "", labId = "" } = useParams();
  const { data, isLoading, error } = useApi(api.api.classes);

  const teaching = data?.classes.find((c) => c.id === classId);
  const enrolled = data?.enrolled.find((c) => c.id === classId);
  const cls = teaching ?? enrolled;
  const lab = cls?.labs.find((l) => l.id === labId);
  const role = teaching ? "teaching" : "enrolled";
  const pending = enrolled?.state === "pending";

  return (
    <Loading loading={isLoading} className="flex-1">
      {error || !cls || !lab ? (
        <Page>
          <Text variant="error">
            {error
              ? "Couldn't load this lab — refresh to retry."
              : "This lab doesn't exist (or you're not in its class)."}
          </Text>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Page>
      ) : (
        <Page>
          <Stack gap="sm" className="w-full">
            <Link
              to="/classes"
              className="self-start text-muted-foreground text-sm hover:underline"
            >
              ‹ Classes / {cls.name ?? cls.login}
            </Link>
            <Row justify="between" wrap className="w-full">
              <Row gap="sm" wrap>
                <Text variant="heading">{lab.title}</Text>
                <Badge variant="secondary" className="font-normal">
                  {labModeLabel(lab)}
                </Badge>
                <DeadlineText deadline={new Date(lab.deadline)} />
                <Text variant="body2" className="tabular-nums">
                  {formatDeadline(new Date(lab.deadline))}
                </Text>
              </Row>
              <RoleChip kind={role} />
            </Row>
          </Stack>

          {pending ? (
            <Text variant="body2">
              Accept your invitation on GitHub first — then you can accept this
              lab.
            </Text>
          ) : role === "enrolled" && lab.groupMode === "individual" ? (
            <IndividualAccept classId={classId} lab={lab} />
          ) : (
            <LabGroupsSection
              classId={classId}
              lab={lab}
              kind={role}
              students={teaching?.students}
              users={teaching?.users}
            />
          )}
        </Page>
      )}
    </Loading>
  );
}

/**
 * The student's one-click accept on INDIVIDUAL labs: no group machinery —
 * the server finds-or-creates their solo group and attaches it. Withdrawing
 * detaches it again.
 */
function IndividualAccept({ classId, lab }: { classId: string; lab: LabItem }) {
  const { github } = useAuth();
  const me = github?.login;
  const { data, isLoading, error, mutate } = useApi(labGroupsApi, {
    param: { id: classId, labId: lab.id },
  });
  const { busy, act } = useAction(mutate);

  // The caller's ATTACHED group (the merged endpoint lists all class
  // groups; attachedIds says which participate here).
  const attachedIds = new Set(data?.attachedIds ?? []);
  const mine = data?.groups.find(
    (g) => attachedIds.has(g.id) && g.members.some((m) => m.login === me),
  );

  if (error) {
    return (
      <Text variant="error">Couldn't load your status — refresh to retry.</Text>
    );
  }
  if (isLoading) {
    return <Text variant="body2">Loading…</Text>;
  }

  return (
    <Stack gap="sm" align="start">
      {mine ? (
        <>
          <Row gap="sm">
            <Check className="size-4 text-brand" />
            <Text variant="body1" className="font-medium">
              Accepted
            </Text>
          </Row>
          <Text variant="body2">
            Your repository arrives with a later update — you're in.
          </Text>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy}
            title="Withdraw your acceptance of this lab"
            onClick={() =>
              act(() =>
                labGroupsApi[":groupId"].$delete({
                  param: { id: classId, labId: lab.id, groupId: mine.id },
                }),
              )
            }
          >
            Withdraw
          </Button>
        </>
      ) : (
        <>
          <Text variant="body2">
            This is an individual lab — accepting takes one click.
          </Text>
          <Button
            size="lg"
            type="button"
            disabled={busy}
            title="Accept this lab — you participate individually"
            onClick={() =>
              act(() =>
                api.api.classes[":id"].labs[":labId"].accept.$post({
                  param: { id: classId, labId: lab.id },
                }),
              )
            }
          >
            Accept lab
          </Button>
        </>
      )}
    </Stack>
  );
}
