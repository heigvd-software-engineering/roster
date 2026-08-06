import { GitBranch } from "lucide-react";
import { Text } from "~/components/custom/typography/text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";

/** The group's work repo, linked, opening on GitHub. */
export function RepoLink({ fullName }: { fullName: string }) {
  return (
    <a
      href={`https://github.com/${fullName}`}
      target="_blank"
      rel="noreferrer"
      title="Open the work repository on GitHub"
      className="inline-flex min-w-0 items-center gap-1.5 self-start text-foreground text-xs hover:underline"
    >
      <GitBranch className="size-3.5 flex-none text-muted-foreground" />
      <span className="truncate">{fullName}</span>
    </a>
  );
}

/**
 * Sits next to `RepoLink` when its repo was deleted directly on GitHub
 * (`repoStatus: "missing"`). Visible to everyone, since it is status, but
 * `onUnlink` (present only for the teacher who can act on it) turns this from
 * a dead end into a fix: unlinking flips the group back to "no repo", which
 * reveals the card's own Delete-group and Create-repo controls. No bespoke
 * recovery UI beyond this one button.
 */
export function MissingRepoBadge({
  onUnlink,
  busy = false,
}: {
  onUnlink?: () => void;
  busy?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label="This repository no longer exists on GitHub"
          />
        }
      >
        <Badge variant="destructive">404</Badge>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>
            This repository no longer exists on GitHub
          </PopoverTitle>
        </PopoverHeader>
        {onUnlink ? (
          <>
            <Text variant="caption">
              Unlink it to delete this group or create a new repository.
            </Text>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={busy}
              title="Clear the stale repository link"
              onClick={onUnlink}
            >
              Unlink repository
            </Button>
          </>
        ) : (
          <Text variant="caption">
            Ask your teacher to unlink it so the group can get a new one.
          </Text>
        )}
      </PopoverContent>
    </Popover>
  );
}
