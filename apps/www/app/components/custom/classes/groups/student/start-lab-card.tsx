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
 * The student's "start the lab" surface — ONE card for both lab modes, so
 * the two flows differ in copy, never in structure. Three states:
 *
 *   accept  (individual, not accepted) — the one-click accept CTA;
 *   create  — the work repo doesn't exist yet: offer to create it
 *             (on individual labs that means the accept's repo step failed);
 *   clone   — the repo link and the git commands to get working locally
 *             (or, if `repoStatus` is "missing", a destructive-styled
 *             notice instead — no link, no clone commands for a repo
 *             that's gone).
 */
export function StartLabCard({
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
  /** "missing" = deleted directly on GitHub — only the teacher can fix it
   *  (see `MissingRepoBadge`), so this is informational here, no action. */
  repoStatus?: "ok" | "missing" | undefined;
  busy: boolean;
  onCreate: () => void;
  /** The individual lab's one-click accept (group + repo in one step). */
  onAccept?: () => void;
}) {
  const created = repoFullName !== null;
  const missing = created && repoStatus === "missing";
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
        // earlier states keep the neutral ring. A MISSING repo overrides the
        // "all good" green — the ring is part of what must read as broken.
        created && (missing ? "ring-destructive/60" : "ring-role-enrolled/60"),
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
              missing
                ? "text-destructive"
                : created
                  ? "text-role-enrolled"
                  : "text-muted-foreground",
            )}
          >
            {state === "accept"
              ? "one click to start"
              : state === "create"
                ? mode === "individual"
                  ? "one step left"
                  : "you can start the lab"
                : missing
                  ? "repository deleted on GitHub"
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
          missing ? (
            // No link, no clone commands — both point at a repo that's gone.
            // The badge stays (same explanation as the teacher's), but the
            // headline itself must not be missable the way a small badge can be.
            <Stack gap="xs">
              <Row gap="xs" align="center">
                <Text variant="error" className="font-medium">
                  This repository no longer exists on GitHub
                </Text>
                <MissingRepoBadge />
              </Row>
              <Text variant="body2">
                <span className="font-mono text-xs">{repoFullName}</span> was
                deleted directly on GitHub — ask your teacher to unlink it so
                the group can get a new one. Cloning won't work until then.
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

/** The clone-and-enter snippet as a copyable code block — shared by the
 *  group start-lab card and the individual lab's accepted state. */
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
