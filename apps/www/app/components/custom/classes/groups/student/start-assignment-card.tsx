import {
  MissingRepoBadge,
  RepoLink,
} from "~/components/custom/classes/groups/shared/work-repo";
import { CommandBlock } from "~/components/custom/command-block";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * The student's "start the assignment" surface: ONE card for both assignment
 * modes, so the two flows differ in copy, never in structure. Three states:
 *
 *   accept  individual and not accepted, the one-click accept CTA;
 *   create  the work repo doesn't exist yet, so offer to create it (on
 *           individual assignments that means the accept's repo step failed);
 *   clone   the repo link and the git commands to get working locally, or,
 *           when `repoStatus` is "missing", a destructive-styled notice with
 *           no link and no clone commands for a repo that's gone.
 */
export function StartAssignmentCard({
  mode = "group",
  accepted = true,
  repoFullName,
  repoStatus = "ok",
  busy,
  onCreate,
  onAccept,
}: {
  mode?: "group" | "individual";
  /** Individual: does the solo group exist yet? Group flows render this
   *  card only once the group is ready, so it defaults to true. */
  accepted?: boolean;
  repoFullName: string | null;
  /** "missing" = deleted directly on GitHub. Only the teacher can fix it
   *  (see `MissingRepoBadge`), so this is informational here, no action. */
  repoStatus?: "ok" | "missing" | undefined;
  busy: boolean;
  onCreate: () => void;
  /** The individual assignment's one-click accept (group + repo in one step). */
  onAccept?: () => void;
}) {
  const created = repoFullName !== null;
  const missing = created && repoStatus === "missing";
  const state = !accepted ? "accept" : created ? "clone" : "create";
  const title =
    mode === "individual"
      ? created
        ? "Your assignment is ready"
        : "This assignment is individual"
      : "Your group is ready";
  return (
    <Card
      className={cn(
        "h-full gap-0 p-4",
        // The one state the outline marks is the broken one: a repository
        // that was deleted on GitHub. Everything else keeps the stock ring.
        missing && "ring-destructive/60",
      )}
    >
      <Stack gap="md" className="w-full">
        <Stack gap="none">
          <Text variant="label" className="font-medium">
            {title}
          </Text>
          <span
            className={cn(
              "text-xs",
              missing ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {state === "accept"
              ? "one click to start"
              : state === "create"
                ? mode === "individual"
                  ? "one step left"
                  : "you can start the assignment"
                : missing
                  ? "repository deleted on GitHub"
                  : "repository created, off you go"}
          </span>
        </Stack>
        {state === "accept" ? (
          <>
            <Text variant="body2">
              Accepting creates your personal work repository. There's no group
              to form.
            </Text>
            <Button
              size="lg"
              type="button"
              className="self-start"
              disabled={busy}
              title="Accept this assignment and create your personal work repository"
              onClick={onAccept}
            >
              Accept assignment
            </Button>
          </>
        ) : state === "create" ? (
          <>
            <Text variant="body2">
              {mode === "individual"
                ? "Your repository couldn't be created yet. Try again."
                : "Create your group's work repository to begin."}
            </Text>
            {mode === "individual" ? (
              <Button
                size="sm"
                type="button"
                className="self-start"
                disabled={busy}
                title="Create your work repository"
                onClick={onCreate}
              >
                Create repository
              </Button>
            ) : (
              // Creating the repo LOCKS the group (server: 409 has_repo on
              // join/leave), so make the point of no return explicit.
              <ConfirmDialog
                title="Create the work repository?"
                description="This locks the group: once the repository exists, nobody can join or leave on their own, and only your teacher can change it. Make sure everyone is in before you continue."
                confirmLabel="Create repository"
                onConfirm={onCreate}
                trigger={
                  <Button
                    size="sm"
                    type="button"
                    className="self-start"
                    disabled={busy}
                    title="Create your group's work repository, which locks the group"
                  >
                    Create repository
                  </Button>
                }
              />
            )}
          </>
        ) : repoFullName !== null ? (
          missing ? (
            // No link, no clone commands: both point at a repo that's gone.
            // The badge stays (same explanation as the teacher's), but the
            // headline must not be missable the way a small badge can be.
            <Stack gap="xs">
              <Row gap="xs" align="center">
                <Text variant="error" className="font-medium">
                  This repository no longer exists on GitHub
                </Text>
                <MissingRepoBadge />
              </Row>
              <Text variant="body2">
                {repoFullName} was deleted directly on GitHub. Your teacher can
                unlink it so the group can get a new one. Cloning won't work
                until then.
              </Text>
            </Stack>
          ) : (
            <>
              <RepoLink fullName={repoFullName} />
              <Text variant="body2">Clone it to work locally:</Text>
              <CloneCommands fullName={repoFullName} />
            </>
          )
        ) : null}
      </Stack>
    </Card>
  );
}

/** The clone-and-enter snippet as a copyable code block, shared by the group
 *  start-assignment card and the individual assignment's accepted state. */
function CloneCommands({
  fullName,
  className,
}: {
  fullName: string;
  className?: string;
}) {
  return (
    <CommandBlock
      className={className}
      label="Copy the git commands"
      commands={`git clone https://github.com/${fullName}.git\ncd ${fullName.split("/")[1]}`}
    />
  );
}
