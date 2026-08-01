import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { GroupMembers } from "~/components/custom/classes/groups/shared/group-card";
import { DisclosureToggle } from "~/components/custom/disclosure-toggle";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Stack } from "~/components/custom/layout/stack";
import { CAPS_LABEL, Text } from "~/components/custom/typography/text";
import { AvatarGroup, AvatarGroupCount } from "~/components/ui/avatar";
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
 * teacher sees every group in the class (scoped by a lab select). A creating
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
  const [showBlocked, setShowBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Teacher: a full-width lab select scopes the list to ONE lab, defaulting
  // to the previous lab (the list is createdAt-desc, so the first group's
  // lab is the most recent source — the likeliest team to carry forward).
  // A student's list is already small (one group per lab), so it stays flat
  // with the lab named inline.
  const labTitles = [...new Set(reusable.map((r) => r.labTitle))];
  const labSelect = !autoJoins && labTitles.length > 1;
  const activeLab = labChoice ?? labTitles[0];
  const shown = labSelect
    ? reusable.filter((r) => r.labTitle === activeLab)
    : reusable;
  const labLabel = (title: string) => {
    const count = reusable.filter((r) => r.labTitle === title).length;
    return `${title} · ${count} group${count === 1 ? "" : "s"}`;
  };
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
                {labSelect ? (
                  <div className="px-1.5 pt-0.5 pb-1.5">
                    <Select
                      // value→label map so the trigger shows the label.
                      items={Object.fromEntries(
                        labTitles.map((title) => [title, labLabel(title)]),
                      )}
                      value={activeLab}
                      onValueChange={(value: string | null) =>
                        setLabChoice(value)
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-full"
                        title="Pick the lab to reuse a group from"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {labTitles.map((title) => (
                          <SelectItem key={title} value={title}>
                            {labLabel(title)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {usable.map((group) => (
                  <SourceRow
                    key={group.id}
                    group={group}
                    users={users}
                    showLab={!labSelect}
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
                    {/* Collapsed by default: unavailable sources are noise
                        until the user wonders where a group went. */}
                    <div className="flex items-center justify-between pl-2">
                      <span
                        className={cn(
                          CAPS_LABEL,
                          "flex items-center gap-1.5 text-warning",
                        )}
                      >
                        <span className="size-1 rounded-full bg-current" />
                        Unavailable
                        <span className="opacity-70">{blocked.length}</span>
                      </span>
                      <DisclosureToggle
                        expanded={showBlocked}
                        onToggle={() => setShowBlocked(!showBlocked)}
                        label={
                          showBlocked
                            ? "Hide the unavailable groups"
                            : `Show ${blocked.length} unavailable group${
                                blocked.length === 1 ? "" : "s"
                              }`
                        }
                        controls={
                          showBlocked ? "unavailable-sources" : undefined
                        }
                      />
                    </div>
                    {showBlocked ? (
                      <div id="unavailable-sources">
                        {blocked.map((group) => (
                          <SourceRow
                            key={group.id}
                            group={group}
                            users={users}
                            showLab={!labSelect}
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
                      </div>
                    ) : null}
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

/** The visual radio: the whole row is the button, this is its affordance —
 *  an option looks like an option before anything is clicked. */
function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 flex-none items-center justify-center rounded-full border",
        selected ? "border-foreground" : "border-muted-foreground/60",
      )}
    >
      {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
    </span>
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
        selected && "bg-muted/60",
      )}
    >
      <RadioMark selected={selected} />
      <span className="font-medium text-sm">An empty group</span>
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
  users?: ClassItem["users"] | undefined;
  /** Name the source lab inline (no lab select scoping the list). */
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
    <div className={cn("rounded-md", selected && "bg-muted/60")}>
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
          <RadioMark selected={selected} />
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
      </div>
      {blocker ? (
        // pl-8 tucks the reason under the row's label (past the radio column).
        <p className="pr-2 pb-1.5 pl-8 font-mono text-[11px] text-warning">
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
  users?: ClassItem["users"] | undefined;
}) {
  const userByGithubId = usersByGithubId(users);
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  if (members.length === 0) return null;
  return (
    <AvatarGroup>
      {shown.map((member) => {
        const person = personIdentity(
          member,
          userByGithubId.get(String(member.id)),
        );
        return (
          <UserAvatar
            key={member.id}
            name={person.name}
            src={person.avatarUrl}
            size="sm"
          />
        );
      })}
      {extra > 0 ? (
        <AvatarGroupCount className="font-mono text-[10px]">
          +{extra}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}
