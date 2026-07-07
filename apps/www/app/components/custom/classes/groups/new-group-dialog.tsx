import { useState } from "react";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/lib/api";

/**
 * The New-group dialog (F7): just a name — the group's backing GitHub Team
 * is created secret, and a creating student auto-joins it. The CALLER owns
 * revalidation via `onCreated` (on the lab page: attach the fresh group,
 * which also refreshes the list). Trigger is a ghost tile in the grid.
 */
export function NewGroupDialog({
  classId,
  autoJoins,
  triggerLabel = "New group",
  trigger,
  onCreated,
}: {
  classId: string;
  /** Students auto-join the group they create; teachers stay out. */
  autoJoins: boolean;
  /** Ghost-tile text (student CTA on the lab page reads "Accept…"). */
  triggerLabel?: string;
  /** Replaces the default ghost tile (e.g. a toolbar button). */
  trigger?: React.ReactElement;
  /** Follow-up after creation — attaches and/or revalidates. */
  onCreated: (group: {
    id: string;
    name: string;
    slug: string;
  }) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.classes[":id"].groups.$post({
        param: { id: classId },
        json: { name: name.trim() },
      });
      if (res.status === 409) {
        setError("That group name is already taken in this class.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't create the group — try again.");
        return;
      }
      const body = await res.json();
      await onCreated(body.group);
      setOpen(false);
      setName("");
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? <GhostTile title="Create a new group for this class" />
        }
      >
        <span className="font-mono">+</span> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Groups are reusable across this class's labs.
            {autoJoins ? " You'll join the group you create." : ""}
          </DialogDescription>
        </DialogHeader>
        <Stack gap="sm">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team Alpha"
          />
          {error ? <Text variant="error">{error}</Text> : null}
        </Stack>
        <DialogFooter>
          <Button
            variant="outline"
            title="Close without creating"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={name.trim().length === 0 || submitting}
            title="Create the group (a private GitHub team)"
            onClick={create}
          >
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
