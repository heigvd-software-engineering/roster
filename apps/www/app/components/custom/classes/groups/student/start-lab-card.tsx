import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RepoLink } from "~/components/custom/classes/groups/shared/group-tile";
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
  const commands = `git clone https://github.com/${fullName}.git\ncd ${fullName.split("/")[1]}`;
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(commands);
    setCopied(true);
    clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn("relative w-full rounded-md bg-muted", className)}>
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-foreground text-xs leading-relaxed">
        {commands}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="absolute top-1 right-1"
        aria-label={copied ? "Copied" : "Copy the git commands"}
        title={copied ? "Copied" : "Copy the git commands"}
        onClick={copy}
      >
        {copied ? (
          <Check className="size-4 text-brand" />
        ) : (
          <Copy className="size-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
