import { RepoLink } from "~/components/custom/classes/groups/shared/group-tile";
import { CommandBlock } from "~/components/custom/command-block";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * The student's "start the lab" surface — sits beside YOUR group tile once
 * the group reaches the lab's minimum size. Before the work repo exists it
 * offers to create it; after, it shows the repo link and the git commands
 * to get working locally (copyable).
 */
export function StartLabCard({
  repoFullName,
  busy,
  onCreate,
}: {
  repoFullName: string | null;
  busy: boolean;
  onCreate: () => void;
}) {
  const created = repoFullName !== null;
  return (
    <Card
      className={cn(
        "h-full gap-0 p-4",
        // Colored ONLY once the repo exists — same highlight as your group
        // tile (the Card's outline is a RING, ring-1, not a border);
        // waiting state keeps the neutral ring.
        created && "ring-role-enrolled/60",
      )}
    >
      <Stack gap="md" className="w-full">
        <Stack gap="none">
          <Text variant="label" className="font-medium">
            Your group is ready
          </Text>
          <span
            className={cn(
              "font-mono text-xs",
              created ? "text-role-enrolled" : "text-muted-foreground",
            )}
          >
            {created
              ? "repository created — off you go"
              : "you can start the lab"}
          </span>
        </Stack>
        {repoFullName === null ? (
          <>
            <Text variant="body2">
              Create your group's work repository to begin.
            </Text>
            <Button
              size="sm"
              type="button"
              className="self-start"
              disabled={busy}
              title="Create your group's work repository"
              onClick={onCreate}
            >
              Create repository
            </Button>
          </>
        ) : (
          <>
            <RepoLink fullName={repoFullName} />
            <Text variant="body2">Clone it to work locally:</Text>
            <CloneCommands fullName={repoFullName} />
          </>
        )}
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
