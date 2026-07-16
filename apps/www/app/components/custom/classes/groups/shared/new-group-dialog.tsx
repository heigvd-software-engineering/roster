import { Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { GroupMembers } from "~/components/custom/classes/groups/shared/group-tile";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Stack } from "~/components/custom/layout/stack";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
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
  type ClassItem,
  labGroupsApi,
  type ReusableGroup,
  reusableGroupsApi,
  useApi,
} from "~/lib/api";
import { usersByGithubId } from "~/lib/format";
import { personIdentity } from "~/lib/identity";
import { cn } from "~/lib/utils";

/**
 * The New-group dialog (per-lab model): create a group IN this lab, started
 * from scratch OR **reused** from a group in another lab (copy-forward —
 * same teammates, a fresh team for this lab). "An empty group" is just the
 * first row of one list: scratch-vs-reuse is a selection, not a mode switch.
 * Reuse is ALL-OR-NOTHING — the server annotates each source with why it
 * can't be copied (`blocker`), those rows render disabled with the reason,
 * and the create endpoint enforces the same rule as the backstop. The reuse
 * sources come from the API by role: a student sees their own groups, a
 * teacher sees every group in the class (scoped by lab chips). A creating
 * student auto-joins.
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
      <DialogContent className="sm:max-w-md">
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

type Blocker = NonNullable<ReusableGroup["blocker"]>;

const handles = (logins: string[]) => logins.map((l) => `@${l}`).join(", ");

/** The row's reason line — why this source can't be copied. */
function blockerReason(blocker: Blocker, memberCount: number): string {
  switch (blocker.reason) {
    case "source_empty":
      return "no members to copy — start empty instead";
    case "group_too_large":
      return `${memberCount} members — this lab takes at most ${blocker.max}`;
    case "member_already_placed":
      return `${handles(blocker.logins)} ${
        blocker.logins.length === 1 ? "is" : "are"
      } already in a group of this lab`;
    case "member_not_in_class":
      return `${handles(blocker.logins)} ${
        blocker.logins.length === 1 ? "is" : "are"
      } no longer in the class`;
  }
}

/** The dialog's inline 409 copy — mirrors the server's reuse vocabulary. */
function conflictMessage(code: string | undefined): string {
  switch (code) {
    case "name_taken":
      return "A group with that name already exists in this lab.";
    case "member_already_placed":
      return "Someone in that group has already joined a group of this lab — it can't be reused anymore.";
    case "member_not_in_class":
      return "Someone in that group is no longer in the class — it can't be reused anymore.";
    case "group_too_large":
      return "That group no longer fits this lab's size limit.";
    case "source_empty":
      return "That group has no members to copy — start from an empty group.";
    default:
      return "Couldn't create the group — try again.";
  }
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
  const { data, mutate } = useApi(reusableGroupsApi, {
    param: { id: classId, labId },
  });
  const reusable = data?.groups ?? [];
  const users = data?.users;

  const [name, setName] = useState("");
  const [source, setSource] = useState<ReusableGroup | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [labChoice, setLabChoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Teacher: chips scope the list to ONE lab, defaulting to the previous lab
  // (the list is createdAt-desc, so the first group's lab is the most recent
  // source — the likeliest team to carry forward). A student's list is
  // already small (one group per lab), so it stays flat with the lab inline.
  const labTitles = [...new Set(reusable.map((r) => r.labTitle))];
  const chips = !autoJoins && labTitles.length > 1;
  const activeLab = labChoice ?? labTitles[0];
  const shown = chips
    ? reusable.filter((r) => r.labTitle === activeLab)
    : reusable;
  const usable = shown.filter((r) => r.blocker === null);
  const blocked = shown.filter((r) => r.blocker !== null);

  /** Selecting a source prefills the name — but never over the user's own. */
  function pick(next: ReusableGroup | null) {
    const untouched = name.trim() === "" || name === source?.name;
    setSource(next);
    if (untouched) setName(next ? next.name : "");
  }

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
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(conflictMessage(body.error));
        if (body.error !== "name_taken") {
          // The verdicts changed under us (e.g. someone joined a group here
          // since the dialog opened) — drop the stale pick, refetch the list.
          setSource(null);
          await mutate();
        }
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
        <Stack gap="sm">
          <Label id="start-from-label">Start from</Label>
          <div className="max-h-72 overflow-y-auto rounded-md border p-1">
            <ScratchRow selected={source === null} onPick={() => pick(null)} />
            {reusable.length > 0 ? (
              <>
                <div className="mx-1 my-1 h-px bg-border/60" />
                <div
                  className={cn(
                    CAPS_LABEL,
                    "flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-role-enrolled",
                  )}
                >
                  <span className="size-1 rounded-full bg-current" />
                  Reuse a group
                </div>
                {chips ? (
                  <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                    {labTitles.map((title) => (
                      <button
                        key={title}
                        type="button"
                        title={`Show groups from ${title}`}
                        onClick={() => setLabChoice(title)}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 font-mono text-[11px]",
                          title === activeLab
                            ? "bg-foreground text-background"
                            : "text-muted-foreground ring-1 ring-border hover:text-foreground",
                        )}
                      >
                        {title}
                        <span className="ml-1 opacity-60">
                          {reusable.filter((r) => r.labTitle === title).length}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {usable.map((group) => (
                  <SourceRow
                    key={group.id}
                    group={group}
                    users={users}
                    showLab={!chips}
                    selected={source?.id === group.id}
                    expanded={expandedId === group.id}
                    onPick={() => pick(group)}
                    onToggle={() =>
                      setExpandedId(expandedId === group.id ? null : group.id)
                    }
                  />
                ))}
                {blocked.length > 0 ? (
                  <>
                    <div className="mx-1 my-1 h-px bg-border/60" />
                    <div
                      className={cn(
                        CAPS_LABEL,
                        "flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-warning",
                      )}
                    >
                      <span className="size-1 rounded-full bg-current" />
                      Unavailable
                    </div>
                    {blocked.map((group) => (
                      <SourceRow
                        key={group.id}
                        group={group}
                        users={users}
                        showLab={!chips}
                        selected={false}
                        expanded={expandedId === group.id}
                        onPick={() => {}}
                        onToggle={() =>
                          setExpandedId(
                            expandedId === group.id ? null : group.id,
                          )
                        }
                      />
                    ))}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
          {source ? (
            <Text variant="caption">
              Copies {source.members.length} member
              {source.members.length === 1 ? "" : "s"} into a fresh team for
              this lab.
            </Text>
          ) : data && reusable.length === 0 ? (
            <Text variant="caption">
              No groups from other labs to reuse yet — once another lab has
              groups, you can copy one forward here.
            </Text>
          ) : (
            <Text variant="caption">
              Creates an empty group — members join after.
            </Text>
          )}
        </Stack>
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

/** The pinned first option: create from scratch. */
function ScratchRow({
  selected,
  onPick,
}: {
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
        selected && "ring-1 ring-foreground ring-inset",
      )}
    >
      <span className="flex size-5 flex-none items-center justify-center rounded-full border border-muted-foreground/40 border-dashed text-muted-foreground">
        <Plus className="size-3" />
      </span>
      <span className="font-medium text-sm">An empty group</span>
      <span className="ml-auto flex w-5 flex-none justify-center">
        {selected ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}

/**
 * One reuse source: a dense one-line row (name · avatars · count) with a
 * chevron that expands the full roster in place — UserIdentity rows, same as
 * the group tiles — without changing the selection. Blocked rows are dimmed
 * and spend a second line on WHY (the server's `blocker`), with the blocking
 * member tagged inside the expanded roster.
 */
function SourceRow({
  group,
  users,
  showLab,
  selected,
  expanded,
  onPick,
  onToggle,
}: {
  group: ReusableGroup;
  users?: ClassItem["users"];
  /** Name the source lab inline (no chips scoping the list to one lab). */
  showLab: boolean;
  selected: boolean;
  expanded: boolean;
  onPick: () => void;
  onToggle: () => void;
}) {
  const { blocker } = group;
  const blockedLogins =
    blocker?.reason === "member_already_placed" ||
    blocker?.reason === "member_not_in_class"
      ? blocker.logins
      : [];
  return (
    <div
      className={cn(
        "rounded-md",
        selected && "ring-1 ring-foreground ring-inset",
      )}
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={selected}
          disabled={blocker !== null}
          onClick={onPick}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left",
            blocker ? "opacity-55" : "hover:bg-muted",
          )}
        >
          <span className="truncate font-medium text-sm">{group.name}</span>
          {showLab ? (
            <span className="truncate font-mono text-muted-foreground text-xs">
              {group.labTitle}
            </span>
          ) : null}
          <span className="ml-auto flex flex-none items-center gap-2">
            <AvatarStack members={group.members} users={users} />
            <span className="font-mono text-muted-foreground text-xs">
              {group.members.length === 0 ? "empty" : group.members.length}
            </span>
          </span>
        </button>
        {group.members.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            title={expanded ? "Hide members" : "Show members"}
            onClick={onToggle}
            className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : (
          <span className="size-6 flex-none" />
        )}
        <span className="flex w-5 flex-none justify-center">
          {selected ? <Check className="size-3.5" /> : null}
        </span>
      </div>
      {blocker ? (
        <p className="px-2 pb-1.5 font-mono text-[11px] text-warning">
          {blockerReason(blocker, group.members.length)}
        </p>
      ) : null}
      {expanded ? (
        <div className="mx-2 mb-1.5 border-border/60 border-l-2 py-1 pl-3">
          <GroupMembers
            members={group.members}
            users={users}
            memberAction={(member) =>
              blockedLogins.includes(member.login) ? (
                <span
                  className={cn(CAPS_LABEL, "whitespace-nowrap text-warning")}
                >
                  {blocker?.reason === "member_not_in_class"
                    ? "left the class"
                    : "already placed"}
                </span>
              ) : null
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/** Up to three overlapping avatars + a "+N" chip — the roster at a glance;
 *  the chevron's expansion is where full identities live. */
function AvatarStack({
  members,
  users,
}: {
  members: ReusableGroup["members"];
  users?: ClassItem["users"];
}) {
  const userByGithubId = usersByGithubId(users);
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  if (members.length === 0) return null;
  return (
    <span className="flex items-center">
      {shown.map((member) => {
        const person = personIdentity(
          member,
          userByGithubId.get(String(member.id)),
        );
        return (
          <span
            key={member.id}
            className="-ml-1.5 rounded-full ring-2 ring-background first:ml-0"
          >
            <UserAvatar name={person.name} src={person.avatarUrl} size="sm" />
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="-ml-1.5 flex size-6 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground ring-2 ring-background">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
