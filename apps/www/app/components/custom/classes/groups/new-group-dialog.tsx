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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  labGroupsApi,
  type ReusableGroup,
  reusableGroupsApi,
  useApi,
} from "~/lib/api";

const FROM_SCRATCH = "__scratch__";

/**
 * The New-group dialog (per-lab model): create a group IN this lab. It can
 * be started from scratch OR **reused** from one of the caller's groups in
 * another lab (copy-forward — same teammates, a fresh team for this lab).
 * A creating student auto-joins.
 */
export function NewGroupDialog({
  classId,
  labId,
  autoJoins,
  triggerLabel = "New group",
  trigger,
  onCreated,
}: {
  classId: string;
  labId: string;
  /** Students auto-join the group they create; teachers stay out. */
  autoJoins: boolean;
  triggerLabel?: string;
  /** Replaces the default ghost tile (e.g. a toolbar button). */
  trigger?: React.ReactElement;
  /** Follow-up after creation — revalidates the lab's group list. */
  onCreated: () => unknown;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? <GhostTile title="Create a new group for this lab" />
        }
      >
        <span className="font-mono">+</span> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {/* Mounted only while open → the reuse list is fetched on demand. */}
        {open ? (
          <NewGroupForm
            classId={classId}
            labId={labId}
            autoJoins={autoJoins}
            onClose={() => setOpen(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewGroupForm({
  classId,
  labId,
  autoJoins,
  onClose,
  onCreated,
}: {
  classId: string;
  labId: string;
  autoJoins: boolean;
  onClose: () => void;
  onCreated: () => unknown;
}) {
  const { data } = useApi(reusableGroupsApi, {
    param: { id: classId, labId },
  });
  const reusable = data?.groups ?? [];

  const [name, setName] = useState("");
  const [source, setSource] = useState<ReusableGroup | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await labGroupsApi.$post({
        param: { id: classId, labId },
        json: {
          name: name.trim(),
          ...(source ? { copyFromGroupId: source.id } : {}),
        },
      });
      if (res.status === 409) {
        setError("A group with that name already exists in this lab.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't create the group — try again.");
        return;
      }
      await onCreated();
      onClose();
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New group</DialogTitle>
        <DialogDescription>
          A group for this lab.
          {autoJoins ? " You'll join the group you create." : ""}
        </DialogDescription>
      </DialogHeader>
      <Stack gap="md">
        {reusable.length > 0 ? (
          <Stack gap="sm">
            <Label htmlFor="reuse-group">Start from</Label>
            <Select
              // The value→label map lets the trigger show the label (not the
              // raw id) for the selected option.
              items={{
                [FROM_SCRATCH]: "An empty group",
                ...Object.fromEntries(
                  reusable.map((r) => [
                    r.id,
                    `Reuse “${r.name}” · ${r.labTitle}`,
                  ]),
                ),
              }}
              value={source?.id ?? FROM_SCRATCH}
              onValueChange={(value: string | null) => {
                const picked = reusable.find((r) => r.id === value) ?? null;
                setSource(picked);
                if (picked && name.trim() === "") setName(picked.name);
              }}
            >
              <SelectTrigger id="reuse-group" className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FROM_SCRATCH}>An empty group</SelectItem>
                {reusable.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Reuse “{r.name}” · {r.labTitle} ({r.members.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {source ? (
              <Text variant="caption">
                Copies this group's members into a new team for this lab (anyone
                already in a group here is skipped).
              </Text>
            ) : null}
          </Stack>
        ) : null}
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
      </Stack>
      <DialogFooter>
        <Button
          variant="outline"
          title="Close without creating"
          onClick={onClose}
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
    </>
  );
}
