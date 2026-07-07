import { Check } from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import { RepoLink } from "~/components/custom/classes/groups/group-tile";
import { CloneCommands } from "~/components/custom/classes/groups/start-lab-card";
import { StudentLabGroups } from "~/components/custom/classes/groups/student-lab-groups";
import { useLabGroups } from "~/components/custom/classes/groups/use-lab-groups";
import { LabHeader } from "~/components/custom/classes/labs/lab-header";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import { api, type LabItem, useApi } from "~/lib/api";

/**
 * /classes/:classId/labs/:labId — the STUDENT's lab page: accept the lab
 * (one click on individual labs, the group flows on group labs).
 * Deliberately its own page (not a role branch): F8+ grows it into the
 * student's repo and standing. A caller who TEACHES this class is
 * redirected to the manage page.
 */
export function StudentLabPage() {
  const { classId = "", labId = "" } = useParams();
  const { data, isLoading, error } = useApi(api.api.classes);

  const enrolled = data?.enrolled.find((c) => c.id === classId);
  const lab = enrolled?.labs.find((l) => l.id === labId);
  const teachesInstead = !enrolled
    ? data?.classes.some((c) => c.id === classId)
    : false;
  const pending = enrolled?.state === "pending";

  return (
    <Loading loading={isLoading} className="flex-1">
      {teachesInstead ? (
        <Navigate to={`/classes/${classId}/labs/${labId}/manage`} replace />
      ) : error || !enrolled || !lab ? (
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
          <LabHeader
            className={enrolled.name ?? enrolled.login ?? "Class"}
            lab={lab}
            kind="enrolled"
          />
          {pending ? (
            <Text variant="body2">
              Accept your invitation on GitHub first — then you can accept this
              lab.
            </Text>
          ) : lab.groupMode === "individual" ? (
            <IndividualAccept classId={classId} lab={lab} />
          ) : (
            <StudentLabGroups classId={classId} lab={lab} />
          )}
        </Page>
      )}
    </Loading>
  );
}

/**
 * The one-click accept on INDIVIDUAL labs: no group machinery — the server
 * finds-or-creates the solo group, attaches it, and creates the WORK REPO
 * in the same click. Withdrawing is only possible while no repo exists
 * (once it does, the pairing is a deliverable).
 */
function IndividualAccept({ classId, lab }: { classId: string; lab: LabItem }) {
  const { github } = useAuth();
  const me = github?.login;
  const g = useLabGroups(classId, lab);

  const mine = g.groups.find((group) =>
    group.members.some((m) => m.login === me),
  );
  const repo = mine ? g.repoFor(mine.id) : null;

  if (g.error) {
    return (
      <Text variant="error">Couldn't load your status — refresh to retry.</Text>
    );
  }
  if (g.isLoading) {
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
          {repo ? (
            <>
              <Text variant="body2">
                Your work repository — clone it and get going:
              </Text>
              <RepoLink fullName={repo} />
              <CloneCommands fullName={repo} />
            </>
          ) : (
            <>
              <Text variant="body2">
                Your repository couldn't be created yet — try again.
              </Text>
              <Row gap="sm">
                <Button
                  size="sm"
                  type="button"
                  disabled={g.busy}
                  title="Create your work repository"
                  onClick={() => g.createRepo(mine.id)}
                >
                  Create repository
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={g.busy}
                  title="Withdraw your acceptance of this lab"
                  onClick={() => g.deleteGroup(mine.id)}
                >
                  Withdraw
                </Button>
              </Row>
            </>
          )}
        </>
      ) : (
        <>
          <Text variant="body2">
            This is an individual lab — accepting takes one click and creates
            your work repository.
          </Text>
          <Button
            size="lg"
            type="button"
            disabled={g.busy}
            title="Accept this lab — creates your personal work repository"
            onClick={() => g.acceptIndividual()}
          >
            Accept lab
          </Button>
        </>
      )}
    </Stack>
  );
}
