import { UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CommandBlock } from "~/components/custom/command-block";
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
 * Invite a teacher, by GitHub username. Teachers are org OWNERS on GitHub,
 * and the description says so plainly before anything happens. An active
 * member is promoted on the spot; anyone else gets an Owner invitation and
 * shows as pending until they accept on GitHub. Either way the server
 * observes its own write, so the roster is current without a sync.
 */
export function InviteTeacherDialog({
  classId,
  orgLogin,
  onDone,
}: {
  classId: string;
  /** The class's GitHub org: links the caller to the invitation they must
   *  cancel THERE, since only GitHub can withdraw one. */
  orgLogin: string;
  /** The OWNER of the classes data revalidates, as in LabDialog. */
  onDone: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  /** Set once an INVITATION was actually sent (not a promotion): the dialog
   *  stays open to hand the sender a link they can forward. */
  const [invited, setInvited] = useState<string | null>(null);

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setUsername("");
      setError(null);
      setInvited(null);
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
        if ("error" in body && body.error === "already_teacher") {
          setError(`@${name} is already a teacher of this class.`);
          return;
        }
        // An open invitation blocks a second one: GitHub refuses it, and
        // removing the person from the organization does NOT withdraw it.
        // Only GitHub can cancel an invitation, so point straight at the page
        // that does it rather than leaving a dead end.
        setError(
          <>
            @{name} already has a pending invitation. Removing them from the
            organization doesn't withdraw it — cancel the invitation on{" "}
            <a
              href={`https://github.com/orgs/${orgLogin}/people/pending_invitations`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              the organization's pending invitations
            </a>
            , then invite them again.
          </>,
        );
        return;
      }
      if (!res.ok) {
        setError("Couldn't invite the teacher — try again.");
        return;
      }
      const body = await res.json();
      await onDone();
      // A promotion is finished the moment it returns. Only a real INVITATION
      // leaves someone to chase, so only that keeps the dialog open.
      if (body.state === "pending") {
        setInvited(name);
        return;
      }
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
        {invited ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation sent to @{invited}</DialogTitle>
              <DialogDescription>
                GitHub has emailed them. They stay listed as pending here until
                they accept it.
              </DialogDescription>
            </DialogHeader>
            <Stack gap="sm">
              <Text variant="caption">
                Two things have to happen before they can teach here, and
                neither is automatic:
              </Text>
              <ol className="ml-4 list-decimal space-y-1 text-muted-foreground text-sm">
                <li>
                  <span className="text-foreground">
                    Accept the GitHub invitation.
                  </span>{" "}
                  That's what makes them an owner of the organization. GitHub
                  emailed it, but the mail is easy to miss — the link below goes
                  straight to it.
                </li>
                <li>
                  <span className="text-foreground">
                    Sign in here with SWITCH edu-ID
                  </span>{" "}
                  and link{" "}
                  <span className="text-foreground">
                    the same GitHub account
                  </span>{" "}
                  (@{invited}) when asked. Linking a different one leaves the
                  class invisible to them, even after they accept.
                </li>
              </ol>
              <Text variant="caption">
                Forward them this link — signed in as @{invited}, it opens the
                invitation directly:
              </Text>
              <CommandBlock
                commands={`https://github.com/orgs/${orgLogin}/invitation`}
                label="Copy the invitation link"
              />
              <Text variant="caption">
                It isn't a shortcut around GitHub: the invitation shows only to
                the person it was sent to, so forwarding it to anyone else
                grants nothing.
              </Text>
            </Stack>
            <DialogFooter>
              <Button title="Close" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite a teacher</DialogTitle>
              <DialogDescription>
                Teachers are the organization's owners on GitHub. An owner has
                full control of the organization — repositories, members,
                settings — well beyond what roster itself manages.
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
