import { UserPlus } from "lucide-react";
import { useState } from "react";
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
 * Invite a teacher, by GitHub username. Teachers are org OWNERS on GitHub —
 * the description says so plainly before anything happens. An active member
 * is promoted on the spot; anyone else gets an Owner invitation and shows as
 * pending until they accept on GitHub. Either way the server observes its own
 * write, so the roster is current without a sync.
 */
export function InviteTeacherDialog({
  classId,
  onDone,
}: {
  classId: string;
  /** The OWNER of the classes data revalidates — same contract as LabDialog. */
  onDone: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setUsername("");
      setError(null);
    }
  }

  async function submit() {
    const name = username.trim();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.api.classes[":id"].teachers.$post({
        param: { id: classId },
        json: { username: name },
      });
      if (res.status === 404) {
        setError(`No GitHub user named "${name}".`);
        return;
      }
      if (res.status === 409) {
        const body = await res.json();
        setError(
          "error" in body && body.error === "already_teacher"
            ? `@${name} is already a teacher of this class.`
            : `@${name} already has a pending invitation.`,
        );
        return;
      }
      if (!res.ok) {
        setError("Couldn't invite the teacher — try again.");
        return;
      }
      await onDone();
      setOpen(false);
    } catch {
      setError("Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            title="Invite a teacher — a GitHub organization owner"
          />
        }
      >
        <UserPlus className="text-muted-foreground" />
        Invite teacher
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teacher</DialogTitle>
          <DialogDescription>
            Teachers are the organization's owners on GitHub. An owner has full
            control of the organization — repositories, members, settings — well
            beyond what labs itself manages.
          </DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          <Stack gap="sm">
            <Label htmlFor="teacher-username">GitHub username</Label>
            <Input
              id="teacher-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="octocat"
            />
            <Text variant="caption">
              Already a student here? They become a teacher immediately.
              Otherwise GitHub sends them an invitation and they appear as
              pending until they accept.
            </Text>
          </Stack>
          {error ? <Text variant="error">{error}</Text> : null}
        </Stack>
        <DialogFooter>
          <Button
            variant="outline"
            title="Close without inviting"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={username.trim().length === 0 || submitting}
            title="Make this GitHub user an owner of the class's organization"
            onClick={submit}
          >
            Invite teacher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
