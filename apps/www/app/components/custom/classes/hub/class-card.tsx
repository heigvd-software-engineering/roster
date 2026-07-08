import { Check, Link2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PeopleChip } from "~/components/custom/classes/hub/people-chip";
import { LabDialog } from "~/components/custom/classes/labs/lab-dialog";
import { LabRow, LabsHeader } from "~/components/custom/classes/labs/lab-row";
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
import { cn } from "~/lib/utils";

function peopleLabel(count: number, noun: string, pendingCount: number) {
  const base = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return pendingCount > 0 ? `${base} · ${pendingCount} pending` : base;
}

/**
 * One connected class (GitHub org) as a single flat surface: identity + people
 * stats + join-link action in the masthead, then the labs table sectioned off
 * by a hairline — no nested boxes. Everything live: people popovers (F5b),
 * join link (F4), labs + New-lab ghost row (F6).
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
  onChanged,
}: ClassItem & {
  /** The hub's own revalidate — lab edits refresh the data they came from. */
  onChanged: () => unknown;
}) {
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
            label={peopleLabel(teachers.length, "teacher", 0)}
            title="Show the class's teachers"
            emptyText="No teachers found."
            people={teachers.map((p) => withUser(p))}
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={copied ? "Copied" : "Copy student invitation link"}
            title={copied ? "Copied" : "Copy student invitation link"}
            onClick={copyJoinLink}
          >
            {copied ? (
              <Check className="size-4 text-brand" />
            ) : (
              <Link2 className="size-4 text-muted-foreground" />
            )}
          </Button>
          <ReconcileAction classId={id} />
          <RoleChip kind="teaching" />
        </Row>
      </Row>

      {/* The labs table — sectioned off by a hairline, not a nested box. */}
      <div className="w-full overflow-x-auto border-border border-t">
        <div className="min-w-[660px]">
          {labs.length === 0 ? (
            <Text variant="body2" className="px-5 pt-3">
              No labs yet — add the first one.
            </Text>
          ) : (
            <>
              <LabsHeader actions />
              {labs.map((lab) => (
                <LabRow
                  key={lab.id}
                  lab={lab}
                  manage
                  action={
                    <LabDialog classId={id} lab={lab} onSaved={onChanged} />
                  }
                />
              ))}
            </>
          )}
          <LabDialog classId={id} onSaved={onChanged} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Audit + reconcile, beside the join link rather than behind an ellipsis: a
 * teacher whose class has drifted needs to FIND this, and a drifted class is the
 * failure they came to fix.
 *
 * The popover exists because the refresh icon is a lie on its own — this button
 * opens an AUDIT and repairs nothing. Consent is the whole design, and the one
 * place to say so is before the click.
 */
function ReconcileAction({ classId }: { classId: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Audit this class against GitHub"
            title="Audit this class against GitHub"
          />
        }
      >
        <RefreshCw className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <Stack gap="sm">
          <Text variant="body2" className="font-medium text-foreground">
            Audit this class
          </Text>
          <Text variant="caption">
            GitHub owns this class. labs keeps a copy, and it drifts when GitHub
            changes directly.
          </Text>
          <Text variant="caption">
            The audit only reads. You choose what to reconcile; anything that
            removes data stays unticked.
          </Text>
          <Button
            size="sm"
            className="mt-1 w-full"
            render={<Link to={`/classes/${classId}/reconcile`} />}
          >
            Run the audit
          </Button>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
