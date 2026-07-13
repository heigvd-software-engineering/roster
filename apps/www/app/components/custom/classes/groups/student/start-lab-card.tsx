import { RepoLink } from "~/components/custom/classes/groups/shared/group-tile";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { CommandBlock } from "~/components/custom/command-block";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * The student's "start the lab" surface — ONE card for both lab modes, so
 * the two flows differ in copy, never in structure. Three states:
 *
 *   accept  (individual, not accepted) — the one-click accept CTA;
 *   create  — the work repo doesn't exist yet: offer to create it
 *             (on individual labs that means the accept's repo step failed);
 *   clone   — the repo link and the git commands to get working locally.
 */
export function StartLabCard({
  mode = "group",
  accepted = true,
  repoFullName,
  busy,
  onCreate,
  onAccept,
}: {
  mode?: "group" | "individual";
  /** Individual: does the solo group exist yet? Group flows render this
   *  card only once the group is ready, so it defaults to true. */
  accepted?: boolean;
  repoFullName: string | null;
  busy: boolean;
  onCreate: () => void;
  /** The individual lab's one-click accept (group + repo in one step). */
  onAccept?: () => void;
}) {
  const created = repoFullName !== null;
  const state = !accepted ? "accept" : created ? "clone" : "create";
  const title =
    mode === "individual"
      ? created
        ? "Your lab is ready"
        : "This lab is individual"
      : "Your group is ready";
  return (
    <Card
      className={cn(
        "h-full gap-0 p-4",
        // Colored ONLY once the repo exists — same highlight as your group
        // tile (the Card's outline is a RING, ring-1, not a border);
        // earlier states keep the neutral ring.
        created && "ring-role-enrolled/60",
      )}
    >
      <Stack gap="md" className="w-full">
        <Stack gap="none">
          <Text variant="label" className="font-medium">
            {title}
          </Text>
          <span
            className={cn(
              "font-mono text-xs",
              created ? "text-role-enrolled" : "text-muted-foreground",
            )}
          >
            {state === "accept"
              ? "one click to start"
              : state === "create"
                ? mode === "individual"
                  ? "one step left"
                  : "you can start the lab"
                : "repository created — off you go"}
          </span>
        </Stack>
        {state === "accept" ? (
          <>
            <Text variant="body2">
              Accepting creates your personal work repository — no group to
              form.
            </Text>
            <Button
              size="lg"
              type="button"
              className="self-start"
              disabled={busy}
              title="Accept this lab — creates your personal work repository"
              onClick={onAccept}
            >
              Accept lab
            </Button>
          </>
        ) : state === "create" ? (
          <>
            <Text variant="body2">
              {mode === "individual"
                ? "Your repository couldn't be created yet — try again."
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
              // join/leave) — make the point of no return explicit.
              <ConfirmDialog
                title="Create the work repository?"
                description="This locks the group: once the repository exists, nobody can join or leave on their own — only your teacher can change the group. Make sure everyone is in before you continue."
                confirmLabel="Create repository"
                onConfirm={onCreate}
                trigger={
                  <Button
                    size="sm"
                    type="button"
                    className="self-start"
                    disabled={busy}
                    title="Create your group's work repository — this locks the group"
                  >
                    Create repository
                  </Button>
                }
              />
            )}
          </>
        ) : repoFullName !== null ? (
          <>
            <RepoLink fullName={repoFullName} />
            <Text variant="body2">Clone it to work locally:</Text>
            <CloneCommands fullName={repoFullName} />
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

/** The clone-and-enter snippet as a copyable code block — shared by the
 *  group start-lab card and the individual lab's accepted state. */
export function CloneCommands({
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
