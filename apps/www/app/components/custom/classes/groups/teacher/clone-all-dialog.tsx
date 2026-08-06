import { CommandBlock } from "~/components/custom/command-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

/**
 * The start-of-correction chore: every work repo of this assignment, as one
 * clone command per line, copyable in a single go. The repo names already ride
 * on the roster (`repoFullName`), so this is a string transform of what the
 * table shows: no fetch, no loading state.
 *
 * Controlled, because its trigger lives in a dropdown menu: the menu unmounts
 * the item on select, which would take a nested DialogTrigger with it.
 */
export function CloneAllDialog({
  repos,
  open,
  onOpenChange,
}: {
  /** Full names ("org/repo") of the groups that HAVE a repo. */
  repos: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const commands = repos
    .map((fullName) => `git clone https://github.com/${fullName}.git`)
    .join("\n");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A clone line runs ~85 chars ("git clone https://github.com/" + org +
          slug + ".git"), and 2xl fits that at text-xs before <pre> scrolls. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clone every repository</DialogTitle>
          <DialogDescription>
            {repos.length} {repos.length === 1 ? "repository" : "repositories"}.
            Run these from the folder where you want the clones. Each lands in a
            directory named after its group. Re-running is safe: git refuses to
            overwrite a repository you already cloned and clones the rest.
          </DialogDescription>
        </DialogHeader>
        <CommandBlock commands={commands} label="Copy every clone command" />
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
