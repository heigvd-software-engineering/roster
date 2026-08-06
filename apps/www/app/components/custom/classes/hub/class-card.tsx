import { Check, Link2, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AssignmentDialog } from "~/components/custom/classes/assignments/assignment-dialog";
import { AssignmentsTable } from "~/components/custom/classes/assignments/assignments-table";
import { InviteTeacherDialog } from "~/components/custom/classes/hub/invite-teacher-dialog";
import { PeopleChip } from "~/components/custom/classes/hub/people-chip";
import { RoleChip } from "~/components/custom/classes/role-marker";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
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
import { api, type ClassItem, useAction } from "~/lib/api";
import { count } from "~/lib/format";

function peopleLabel(n: number, noun: string, pendingCount: number) {
  const base = count(n, noun);
  return pendingCount > 0 ? `${base} · ${pendingCount} pending` : base;
}

/**
 * One connected class (GitHub org) as a single flat surface: identity + people
 * stats in the masthead (information only), then a toolbar with every class
 * action side by side (New assignment, invite link (F4), GitHub sync), then the
 * assignments table, each sectioned off by a hairline. No nested boxes.
 */
export function ClassCard({
  id,
  login,
  name,
  avatarUrl,
  joinToken,
  teachers,
  students,
  pending,
  pendingTeachers,
  users,
  assignments,
  onChanged,
}: ClassItem & {
  /** The hub's own revalidate: assignment edits refresh the data they came from. */
  onChanged: () => unknown;
}) {
  // Correlate GitHub org members with their roster users. The API returns raw
  // query rows as-is, so the client does the joining.
  const userByGithubId = new Map(users.map((u) => [u.githubId, u.user]));
  const withUser = (p: ClassItem["students"][number], pendingRow = false) => ({
    ...p,
    user: userByGithubId.get(String(p.id)) ?? null,
    pending: pendingRow,
  });
  return (
    <Card className="w-full gap-0 py-0">
      <Row justify="between" wrap className="px-5 py-4">
        <a
          href={`https://github.com/${login}`}
          target="_blank"
          rel="noreferrer"
          className="-m-2 rounded-md p-2 hover:bg-muted"
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
              // Invited as an Owner, so they wait beside the teachers they are
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

      {/* The class toolbar: create, invite and sync side by side, so one row
          answers "what can I do to this class". The masthead above carries
          information only. */}
      <Row gap="sm" wrap className="border-border border-t px-3 py-2">
        <AssignmentDialog classId={id} onSaved={onChanged} />
        <JoinLinkAction
          classId={id}
          joinToken={joinToken}
          onChanged={onChanged}
        />
        <InviteTeacherDialog classId={id} orgLogin={login} onDone={onChanged} />
        <ReconcileAction classId={id} />
      </Row>

      {/* Sectioned off by a hairline, not a nested box. */}
      <div className="w-full border-border border-t">
        {assignments.length === 0 ? (
          <Text variant="body2" className="px-5 py-3">
            No assignments yet — use "New assignment" above.
          </Text>
        ) : (
          <AssignmentsTable
            assignments={assignments}
            manage
            action={(assignment) => (
              <AssignmentDialog
                classId={id}
                assignment={assignment}
                onSaved={onChanged}
              />
            )}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * The class join link, behind a popover rather than a bare copy button: the one
 * thing a teacher gets wrong here is thinking they invite students to a
 * ASSIGNMENT. They don't: one link enrolls a student into the whole CLASS, and
 * every assignment follows from that membership. The popover says so, before
 * the copy.
 */
function JoinLinkAction({
  classId,
  joinToken,
  onChanged,
}: {
  classId: string;
  joinToken: string;
  onChanged: () => unknown;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);
  const { busy, act } = useAction(async () => {
    await onChanged();
  });

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
          <Text variant="label" className="font-medium">
            Invite students
          </Text>
          <Text variant="caption">
            One link per class, not per assignment. Share it once — a student
            who joins enrols in this whole class and gets every assignment in
            it, now and later.
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
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={busy}
                title="Retire this link and issue a new one"
              >
                <RotateCcw className="size-4" />
                Reset link
              </Button>
            }
            title="Reset the invitation link?"
            description="The current link stops working immediately and a new one takes its place — share it with the class again. Students who already joined keep their access; the link only ever controlled getting in."
            confirmLabel="Reset link"
            onConfirm={() =>
              act(() =>
                api.api.classes[":id"]["join-token"].$post({
                  param: { id: classId },
                }),
              )
            }
          />
        </Stack>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reconciliation's entry point, labeled "GitHub sync": the word in a teacher's
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
          <Text variant="label" className="font-medium">
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
