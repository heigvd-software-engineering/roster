import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { GroupMembers } from "~/components/custom/classes/groups/shared/group-card";
import { Pill } from "~/components/custom/classes/groups/shared/pill";
import { DisclosureToggle } from "~/components/custom/disclosure-toggle";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { GhostTile } from "~/components/custom/layout/ghost-tile";
import { Row } from "~/components/custom/layout/row";
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
import { count, usersByGithubId } from "~/lib/format";
import { personIdentity } from "~/lib/identity";
import { cn } from "~/lib/utils";

/**
 * The New-group dialog (per-lab model): create a group IN this lab, started
 * from scratch OR **reused** from a group in another lab (copy-forward —
 * same members, a fresh GitHub team for this lab). The fork is two
 * first-class cards ("An empty group" / "Reuse a group" with an availability
 * chip); picking reuse reveals the source list below — still a selection,
 * not a mode switch: Create stays the single verb, disabled until a source
 * is picked. Reuse is ALL-OR-NOTHING — the server annotates each source with
 * why it can't be copied (`blocker`), those rows render disabled with the
 * reason, and the create endpoint enforces the same rule as the backstop.
 * The reuse sources come from the API by role: a student sees their own
 * groups, a teacher sees every group in the class (scoped by a lab select).
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
      <DialogContent className="gap-5 sm:max-w-2xl">
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
      return `${count(memberCount, "member")} — this lab takes at most ${blocker.max}`;
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

/** The fork's ONE state: scratch, or reuse with the picked source id (null =
 *  reuse chosen, nothing picked yet). "Scratch with a source" is simply
 *  unrepresentable, so no handler has to keep two fields consistent. */
type StartFrom =
  | { kind: "scratch" }
  | { kind: "reuse"; sourceId: string | null };

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
  const [startFrom, setStartFrom] = useState<StartFrom>({ kind: "scratch" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLoaded = data !== undefined;
  const nothingToReuse = isLoaded && reusable.length === 0;
  // The reuse card's advertisement: copyable sources across ALL labs (the
  // picker's lab select scopes the list, not this count).
  const copyable = reusable.filter((r) => r.blocker === null);
  // Derived fresh each render so a revalidation re-checks the pick against
  // the server's verdicts: a source that got blocked under us deselects
  // itself instead of surviving as a stale snapshot.
  const source =
    startFrom.kind === "reuse" && startFrom.sourceId !== null
      ? (reusable.find(
          (r) => r.id === startFrom.sourceId && r.blocker === null,
        ) ?? null)
      : null;

  /** Selecting a source prefills the name — but never over the user's own. */
  function pick(next: ReusableGroup | null) {
    const untouched = name.trim() === "" || name === source?.name;
    setStartFrom(
      next ? { kind: "reuse", sourceId: next.id } : { kind: "scratch" },
    );
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
          setStartFrom((prev) =>
            prev.kind === "reuse" ? { kind: "reuse", sourceId: null } : prev,
          );
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
          {/* The fork, promoted to two first-class cards: scratch-vs-reuse is
              the dialog's core decision, so it looks like one — reuse used to
              hide behind a caps label inside the scroll box. Still a
              selection, not a mode switch. */}
          <fieldset
            aria-labelledby="start-from-label"
            className="grid min-w-0 gap-3 sm:grid-cols-2"
          >
            <StartFromCard
              selected={startFrom.kind === "scratch"}
              label="An empty group"
              description="Starts with no members."
              onPick={() => pick(null)}
            />
            <StartFromCard
              selected={startFrom.kind === "reuse"}
              // Disabled while the list loads (no dead-end if it comes back
              // empty) and disabled-but-VISIBLE when there's nothing to copy
              // — the card still teaches that reuse exists.
              disabled={!isLoaded || nothingToReuse}
              label="Reuse a group"
              description={
                nothingToReuse
                  ? "No groups from other labs yet — once another lab has groups, you can copy one forward."
                  : "Copy the same members forward from an earlier lab."
              }
              onPick={() =>
                setStartFrom((prev) =>
                  prev.kind === "reuse"
                    ? prev
                    : { kind: "reuse", sourceId: null },
                )
              }
            >
              {isLoaded && !nothingToReuse ? (
                <AvailabilityChip copyable={copyable.length} />
              ) : null}
            </StartFromCard>
          </fieldset>
        </Stack>
        {/* The source picker only exists once reuse is chosen — the scratch
            path stays a two-click flow, and the picker gets room to breathe. */}
        {startFrom.kind === "reuse" && reusable.length > 0 ? (
          <ReuseSourcePicker
            groups={reusable}
            users={users}
            scopeByLab={!autoJoins}
            selectedId={source?.id ?? null}
            onPick={pick}
          />
        ) : null}
        <Stack gap="sm">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team Alpha"
          />
          <Text variant="caption">
            {source
              ? `Copied from ${source.name} — rename freely.`
              : "Pick any name — it becomes the group's private GitHub team."}
          </Text>
          {error ? <Text variant="error">{error}</Text> : null}
        </Stack>
      </Stack>
      <DialogFooter className="items-stretch gap-3 sm:items-center">
        {/* The outcome, readable at the moment of commitment — next to the
            button that triggers it. */}
        <Text variant="caption" className="min-w-0 flex-1">
          {source
            ? `Copies ${count(source.members.length, "member")} into a fresh group for this lab.`
            : startFrom.kind === "reuse"
              ? "Pick a group above to copy its members forward."
              : "Creates an empty group — members join after."}
        </Text>
        <Button
          variant="outline"
          title="Close without creating"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          disabled={
            name.trim().length === 0 ||
            submitting ||
            (startFrom.kind === "reuse" && source === null)
          }
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

/** The indent that clears the radio column: RadioMark's size-4 + the row's
 *  gap-2. Named once so resizing the radio can't silently misalign the
 *  card's description and meta lines. */
const RADIO_GUTTER = "pl-6";

/** One side of the fork: a big selectable card — radio + label + one-line
 *  description, `children` for meta like the reuse card's availability
 *  chip. (`label`, not `title`: title stays the tooltip, as everywhere.) */
function StartFromCard({
  selected,
  disabled = false,
  label,
  description,
  onPick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onPick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors hover:bg-muted",
        "disabled:pointer-events-none disabled:opacity-55",
        selected && "border-foreground bg-muted",
      )}
    >
      <span className="flex items-center gap-2">
        <RadioMark selected={selected} />
        <span className="font-medium text-sm">{label}</span>
      </span>
      <span className={cn(RADIO_GUTTER, "text-muted-foreground text-xs")}>
        {description}
      </span>
      {children !== undefined ? (
        <span className={cn(RADIO_GUTTER, "pt-0.5")}>{children}</span>
      ) : null}
    </button>
  );
}

/** The reuse card's self-advertisement: how many sources are copyable RIGHT
 *  NOW (0 = every candidate wears a blocker). */
function AvailabilityChip({ copyable }: { copyable: number }) {
  return copyable > 0 ? (
    <Pill tone="good">{count(copyable, "group")} available</Pill>
  ) : (
    <Pill tone="warn">none available right now</Pill>
  );
}

/**
 * The reuse source list. Teacher (`scopeByLab`): a lab select scopes the
 * list to ONE lab, defaulting to the most recent (the list is createdAt-desc,
 * so the first title is the likeliest team to carry forward). A student's
 * list is already small (one group per lab), so it stays flat with the lab
 * named inline. Owns the view-only state (lab scope, roster expansion) —
 * the selection belongs to the form.
 */
function ReuseSourcePicker({
  groups,
  users,
  scopeByLab,
  selectedId,
  onPick,
}: {
  groups: ReusableGroup[];
  users?: ClassItem["users"] | undefined;
  scopeByLab: boolean;
  selectedId: string | null;
  onPick: (group: ReusableGroup) => void;
}) {
  const [labChoice, setLabChoice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // One pass: lab title → group count, in list order.
  const labCounts = new Map<string, number>();
  for (const g of groups)
    labCounts.set(g.labTitle, (labCounts.get(g.labTitle) ?? 0) + 1);
  const labTitles = [...labCounts.keys()];
  const labSelect = scopeByLab && labTitles.length > 1;
  const activeLab = labChoice ?? labTitles[0];
  const shown = labSelect
    ? groups.filter((r) => r.labTitle === activeLab)
    : groups;
  const usable = shown.filter((r) => r.blocker === null);
  const blocked = shown.filter((r) => r.blocker !== null);
  const labLabel = (title: string) =>
    `${title} · ${count(labCounts.get(title) ?? 0, "group")}`;
  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <Stack gap="sm">
      {labSelect ? (
        <Row gap="md">
          <Label
            htmlFor="reuse-lab"
            className="flex-none text-muted-foreground"
          >
            From lab
          </Label>
          <Select
            // value→label map so the trigger shows the label.
            items={Object.fromEntries(
              labTitles.map((title) => [title, labLabel(title)]),
            )}
            value={activeLab}
            onValueChange={(value: string | null) => setLabChoice(value)}
          >
            <SelectTrigger
              id="reuse-lab"
              className="h-9 flex-1"
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
        </Row>
      ) : null}
      <div className="max-h-72 overflow-y-auto rounded-lg border p-1">
        {usable.map((group) => (
          <SourceRow
            key={group.id}
            group={group}
            users={users}
            showLab={!labSelect}
            selected={selectedId === group.id}
            expanded={expandedId === group.id}
            onPick={() => onPick(group)}
            onToggle={() => toggle(group.id)}
          />
        ))}
        {usable.length > 0 && blocked.length > 0 ? (
          <div className="mx-1 my-1 h-px bg-border/60" />
        ) : null}
        <BlockedSources
          groups={blocked}
          users={users}
          showLab={!labSelect}
          expandedId={expandedId}
          onToggle={toggle}
        />
      </div>
    </Stack>
  );
}

/** The unavailable sources, collapsed by default: blocked groups are noise
 *  until the user wonders where one went. Owns its own disclosure. */
function BlockedSources({
  groups,
  users,
  showLab,
  expandedId,
  onToggle,
}: {
  groups: ReusableGroup[];
  users?: ClassItem["users"] | undefined;
  showLab: boolean;
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const [show, setShow] = useState(false);
  if (groups.length === 0) return null;
  return (
    <>
      <Row gap="sm" justify="between" className="pl-2">
        <span
          className={cn(CAPS_LABEL, "flex items-center gap-1.5 text-warning")}
        >
          <span className="size-1 rounded-full bg-current" />
          Unavailable
          <span className="opacity-70">{groups.length}</span>
        </span>
        <DisclosureToggle
          expanded={show}
          onToggle={() => setShow(!show)}
          label={
            show
              ? "Hide the unavailable groups"
              : `Show ${count(groups.length, "unavailable group")}`
          }
          controls={show ? "unavailable-sources" : undefined}
        />
      </Row>
      {show ? (
        <div id="unavailable-sources">
          {groups.map((group) => (
            <SourceRow
              key={group.id}
              group={group}
              users={users}
              showLab={showLab}
              selected={false}
              expanded={expandedId === group.id}
              onPick={() => {}}
              onToggle={() => onToggle(group.id)}
            />
          ))}
        </div>
      ) : null}
    </>
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
    <div className={cn("rounded-md", selected && "bg-role-enrolled/10")}>
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={selected}
          disabled={blocker !== null}
          onClick={onPick}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left",
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
