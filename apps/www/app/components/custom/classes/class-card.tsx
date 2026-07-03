import { useEffect, useRef, useState } from "react";
import { LabRow } from "~/components/custom/classes/lab-row";
import { NewLabDialog } from "~/components/custom/classes/new-lab-dialog";
import { PeopleChip } from "~/components/custom/classes/people-chip";
import { UserAvatar } from "~/components/custom/identity/user-avatar";
import { Panel } from "~/components/custom/layout/panel";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import type { ClassItem } from "~/lib/api";

function peopleLabel(count: number, noun: string, pendingCount: number) {
  const base = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return pendingCount > 0 ? `${base} · ${pendingCount} pending` : base;
}

/**
 * One connected class (GitHub org): identity + state + its labs — everything
 * live: people chips (F5b), join link (F4), labs list + New-lab dialog (F6).
 * Sits on the standard Panel surface; the white inset labs list reads as its
 * own level. Lab progress stays `—` until F8.
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
  users,
  labs,
}: ClassItem) {
  // Correlate GitHub org members with their labs users (raw query rows from
  // the API — the client does the joining, endpoints return results as-is).
  const userByGithubId = new Map(users.map((u) => [u.githubId, u.user]));
  const withUser = (p: ClassItem["students"][number], pendingRow = false) => ({
    ...p,
    user: userByGithubId.get(String(p.id)) ?? null,
    pending: pendingRow,
  });
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
    <Panel>
      <Row justify="between" wrap>
        <a
          href={`https://github.com/${login}`}
          target="_blank"
          rel="noreferrer"
          className="-m-2 rounded-md p-2 transition-colors hover:bg-background/60"
        >
          <Row gap="sm">
            <UserAvatar name={name ?? login} src={avatarUrl} size="lg" />
            <Stack gap="none">
              <Text variant="body1" className="font-semibold">
                {name ?? login}
              </Text>
              <Text variant="body2">@{login}</Text>
            </Stack>
          </Row>
        </a>
        <Row gap="sm" wrap>
          <PeopleChip
            label={peopleLabel(students.length, "student", pending.length)}
            emptyText="No students yet — share the join link."
            people={[
              ...students.map((p) => withUser(p)),
              ...pending.map((p) => withUser(p, true)),
            ]}
          />
          <PeopleChip
            label={peopleLabel(teachers.length, "teacher", 0)}
            emptyText="No teachers found."
            people={teachers.map((p) => withUser(p))}
          />
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={copyJoinLink}
          >
            {copied ? "Copied ✓" : "Copy join link"}
          </Button>
        </Row>
      </Row>

      {/* The labs list — a white inset panel against the muted card. */}
      <Stack
        gap="none"
        className="w-full rounded-lg border border-border bg-background px-4 py-1"
      >
        {labs.length === 0 ? (
          <Text variant="body2" className="py-2">
            No labs yet — add the first one.
          </Text>
        ) : (
          labs.map((lab) => <LabRow key={lab.id} lab={lab} />)
        )}
      </Stack>

      <Row>
        <NewLabDialog classId={id} />
      </Row>
    </Panel>
  );
}
