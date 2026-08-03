import { Check, Link2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { InviteTeacherDialog } from "~/components/custom/classes/hub/invite-teacher-dialog";
import { PeopleChip } from "~/components/custom/classes/hub/people-chip";
import { LabDialog } from "~/components/custom/classes/labs/lab-dialog";
import { LabsTimeline } from "~/components/custom/classes/labs/labs-timeline";
import { RoleChip, roleSpine } from "~/components/custom/classes/role-marker";
import { OrgIdentity } from "~/components/custom/identity/org-identity";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { ClassItem } from "~/lib/api";
import { count } from "~/lib/format";
import { semesterOf, timelineSpan } from "~/lib/semester";
import { cn } from "~/lib/utils";

function peopleLabel(n: number, noun: string, pendingCount: number) {
  const base = count(n, noun);
  return pendingCount > 0 ? `${base} · ${pendingCount} pending` : base;
}

/**
 * One connected class (GitHub org) as a single flat surface: identity + people
 * stats in the masthead (information only), then a toolbar with every class
 * action side by side — New lab, invite link (F4), GitHub sync — then the labs
 * table (F6), each sectioned off by a hairline — no nested boxes.
 */
export function ClassCard({
  id,
  login,
  name,
  avatarUrl,
  createdAt,
  joinToken,
  teachers,
  students,
  pending,
  pendingTeachers,
  users,
  labs,
  onChanged,
}: ClassItem & {
  /** The hub's own revalidate — lab edits refresh the data they came from. */
  onChanged: () => unknown;
}) {
  // Correlate GitHub org members with their roster users (raw query rows from
  // the API — the client does the joining, endpoints return results as-is).
  const userByGithubId = new Map(users.map((u) => [u.githubId, u.user]));
  const withUser = (p: ClassItem["students"][number], pendingRow = false) => ({
    ...p,
    user: userByGithubId.get(String(p.id)) ?? null,
    pending: pendingRow,
  });
  return (
    <Card
      className={cn(
        "w-full gap-0 py-0 transition-shadow hover:ring-foreground/20",
        roleSpine("teaching"),
      )}
    >
      <Row justify="between" wrap className="px-5 py-4">
        <a
          href={`https://github.com/${login}`}
          target="_blank"
          rel="noreferrer"
          className="-m-2 rounded-md p-2 transition-colors hover:bg-muted/60"
        >
          <OrgIdentity
            name={name ?? login}
            login={login}
            avatarUrl={avatarUrl}
            size="lg"
          />
        </a>
        <Row gap="sm" wrap>
          <PeopleChip
            label={peopleLabel(students.length, "student", pending.length)}
            title="Show the enrolled students and their GitHub accounts"
            emptyText="No students yet — share the join link."
            people={[
              ...students.map((p) => withUser(p)),
              ...pending.map((p) => withUser(p, true)),
            ]}
          />
          <span className="font-mono text-muted-foreground/60 text-xs">·</span>
          <PeopleChip
            label={peopleLabel(
              teachers.length,
              "teacher",
              pendingTeachers.length,
            )}
            title="Show the class's teachers"
            emptyText="No teachers found."
            people={[
              ...teachers.map((p) => withUser(p)),
              // Invited as an Owner — waiting beside the teachers they are
              // joining, not among the students.
              ...pendingTeachers.map((p) => withUser(p, true)),
            ]}
            pendingHint={
              <>
                An invited teacher owes two separate steps, and neither happens
                on its own. First they accept the GitHub invitation, which makes
                them an owner of the organization — only they can do that, on
                GitHub. Then they sign in here with SWITCH edu-ID and link the
                same GitHub account they were invited as; linking a different
                one leaves this class invisible to them even though the
                invitation was accepted.
              </>
            }
          />
          <RoleChip kind="teaching" />
        </Row>
      </Row>

      {/* The class toolbar: every action side by side — create, invite, sync —
          so one row answers "what can I do to this class". The masthead above
          carries information only. */}
      <Row gap="sm" wrap className="border-border border-t px-3 py-1">
        <LabDialog classId={id} onSaved={onChanged} />
        <ToolbarDivider />
        <JoinLinkAction joinToken={joinToken} />
        <ToolbarDivider />
        <InviteTeacherDialog classId={id} orgLogin={login} onDone={onChanged} />
        <ToolbarDivider />
        <ReconcileAction classId={id} />
      </Row>

      {/* The labs timeline — sectioned off by a hairline, not a nested box. */}
      <div className="w-full overflow-x-auto border-border border-t">
        <div className="min-w-[760px]">
          {labs.length === 0 ? (
            <Text variant="body2" className="px-5 py-3">
              No labs yet — use "New lab" above.
            </Text>
          ) : (
            <LabsTimeline
              labs={labs}
              span={timelineSpan(labs, semesterOf(new Date(createdAt)))}
              manage
              action={(lab) => (
                <LabDialog classId={id} lab={lab} onSaved={onChanged} />
              )}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

/** Hairline between toolbar actions — makes the row read as one toolbar,
 *  not three stray buttons. */
function ToolbarDivider() {
  return <span aria-hidden className="h-4 w-px bg-border" />;
}

/**
 * The class join link, behind a popover rather than a bare copy button: the one
 * thing a teacher gets wrong here is thinking they invite students to a LAB.
 * They don't — one link enrolls a student into the whole CLASS, and every lab
 * follows from that membership. The popover is where we say so, before the copy.
 */
function JoinLinkAction({ joinToken }: { joinToken: string }) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  async function copyJoinLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}/join/${joinToken}`,
    );
    setCopied(true);
    clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            title="Student invitation link"
          />
        }
      >
        <Link2 className="text-muted-foreground" />
        Invite students
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Stack gap="sm">
          <Text variant="body2" className="font-medium text-foreground">
            Invite students
          </Text>
          <Text variant="caption">
            One link per class, not per lab. Share it once — a student who joins
            enrols in this whole class and gets every lab in it, now and later.
          </Text>
          <Text variant="caption">
            Joining makes the student a member of the class's GitHub
            organization; they accept a GitHub invitation to finish.
          </Text>
          <Button
            size="sm"
            type="button"
            className="mt-1 w-full"
            onClick={copyJoinLink}
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Copied
              </>
            ) : (
              <>
                <Link2 className="size-4" />
                Copy invitation link
              </>
            )}
          </Button>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reconciliation's entry point, labeled "GitHub sync" — the word in a teacher's
 * head when the class has drifted ("audit"/"reconcile" is system vocabulary),
 * and the label a new user can read without hovering.
 *
 * The popover carries the honesty the label gives up: this button opens a
 * read-only comparison and repairs nothing. Consent is the whole design, and
 * the one place to say so is before the click.
 */
function ReconcileAction({ classId }: { classId: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            title="Sync this class with GitHub"
          />
        }
      >
        <RefreshCw className="text-muted-foreground" />
        GitHub sync
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Stack gap="sm">
          <Text variant="body2" className="font-medium text-foreground">
            Sync with GitHub
          </Text>
          <Text variant="caption">
            roster orchestrates this class on GitHub — day to day, everything is
            managed from the app. But changes can still be made directly on
            GitHub; sync is how you track and fix them.
          </Text>
          <Text variant="caption">
            Syncing starts with a read-only comparison. You choose which
            differences to fix — nothing changes until you apply.
          </Text>
          <Button
            size="sm"
            className="mt-1 w-full"
            render={<Link to={`/classes/${classId}/reconcile`} />}
          >
            Review differences
          </Button>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
