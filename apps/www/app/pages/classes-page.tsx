import { useEffect, useRef, useState } from "react";
import { ClassCard } from "~/components/custom/classes/hub/class-card";
import { EnrolledClassCard } from "~/components/custom/classes/hub/enrolled-class-card";
import { NewClassDialog } from "~/components/custom/classes/hub/new-class-dialog";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";
import { api, type ClassItem, type EnrolledClassItem, useApi } from "~/lib/api";
import { count, formatDay } from "~/lib/format";
import {
  currentSemester,
  previousSemester,
  type Semester,
  semesterEnd,
  semesterLabel,
  semesterOf,
  semesterStart,
} from "~/lib/semester";

/** The heading's exact dates: the semester's own window ("1 Feb → 30 Jun",
 *  end shown inclusive), so the season word above the cards means concrete
 *  dates, the same window a card's timeline falls back to. */
function semesterSpanLabel(group: Entry[]) {
  const first = group[0];
  if (!first) return "";
  const semester = semesterOf(new Date(first.cls.createdAt));
  const lastDay = new Date(semesterEnd(semester).getTime() - 86_400_000);
  return `${formatDay(semesterStart(semester))} → ${formatDay(lastDay)}`;
}

/** One hub entry: a class the caller teaches or one they're enrolled in.
 *  Both carry createdAt and assignments, which is all grouping needs. */
type Entry =
  | { kind: "teaching"; cls: ClassItem }
  | { kind: "enrolled"; cls: EnrolledClassItem };

/** All entries bucketed by the semester they were created in, newest
 *  semester first, newest class first within each. */
function groupBySemester(entries: Entry[]) {
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(b.cls.createdAt).getTime() - new Date(a.cls.createdAt).getTime(),
  );
  const groups = new Map<string, Entry[]>();
  for (const entry of sorted) {
    const label = semesterLabel(semesterOf(new Date(entry.cls.createdAt)));
    const group = groups.get(label) ?? [];
    group.push(entry);
    groups.set(label, group);
  }
  return [...groups.entries()];
}

/**
 * The hub: classes the caller teaches (live, with actions) and classes
 * they're enrolled in (read-only, from the enrollment cache), together
 * under semester headings.
 *
 * Paged by semester to keep the load cheap (every visible teaching class
 * costs live GitHub calls): the first load fetches only the current
 * semester, and "Load more" widens the window one semester back per click.
 * Empty semesters are skipped automatically (summer school is a term too,
 * and most summers are empty).
 */
export function ClassesPage() {
  const { canCreateClasses } = useAuth();
  const [oldest, setOldest] = useState<Semester>(() => currentSemester());
  const { data, isLoading, error, mutate } = useApi(
    api.api.classes,
    { query: { from: semesterStart(oldest).toISOString() } },
    // Each window is its own cache key. Keep the previous window on screen
    // while the widened one loads, with no flash back to the spinner.
    { keepPreviousData: true },
  );
  const entries: Entry[] = [
    ...(data?.classes ?? []).map((cls) => ({ kind: "teaching", cls }) as const),
    ...(data?.enrolled ?? []).map(
      (cls) => ({ kind: "enrolled", cls }) as const,
    ),
  ];

  // Auto-skip: if the window's oldest semester came back empty and older
  // classes exist, widen again so "Load more" always lands on content.
  // Capped per gesture, because a row can be older yet never visible (the
  // caller stopped being that org's owner) and hasOlder alone would widen
  // forever. The cap resets on a manual click, ~2 years per press.
  const autoSkips = useRef(0);
  useEffect(() => {
    // While a window is in flight, `data` is still the previous window
    // (keepPreviousData), and deciding on it would skip semesters the
    // pending response fills. Wait for the fetch.
    if (isLoading) return;
    if (!data?.hasOlder || autoSkips.current >= 6) return;
    const label = semesterLabel(oldest);
    const oldestHasEntries = [...data.classes, ...data.enrolled].some(
      (cls) => semesterLabel(semesterOf(new Date(cls.createdAt))) === label,
    );
    if (!oldestHasEntries) {
      autoSkips.current += 1;
      setOldest(previousSemester(oldest));
    }
  }, [data, oldest, isLoading]);

  return (
    <Page>
      <Row justify="between" className="w-full">
        <Text variant="title">Classes</Text>
        {/* Creation is a granted capability (super-admin zone). Without it
            there is no button to explain, so it's hidden, not disabled. The
            setup callback re-checks server-side either way. */}
        {canCreateClasses ? <NewClassDialog /> : null}
      </Row>
      <Loading loading={isLoading && !data} label="Loading classes…">
        <Stack gap="lg" className="w-full">
          {error ? (
            <Text variant="error">
              Couldn't load your classes — refresh to retry.
            </Text>
          ) : (
            <>
              {entries.length === 0 && !data?.hasOlder ? (
                // The empty hub: plain words, one per role. "New class"
                // (page header) opens the dialog explaining what connecting
                // an organization means. Students don't act here at all:
                // their class arrives through the join link.
                <Stack gap="sm" className="w-full max-w-xl">
                  <Text variant="body2">No classes yet.</Text>
                  <Text variant="caption">
                    {canCreateClasses
                      ? 'Teaching? Use "New class" above — it walks you through how a class maps onto GitHub. A student? There\'s nothing to create: open the class link your teacher shared and your class appears here.'
                      : "A student? There's nothing to create: open the class link your teacher shared and your class appears here."}
                  </Text>
                </Stack>
              ) : null}
              {groupBySemester(entries).map(([label, group]) => (
                <Stack key={label} gap="md" className="w-full">
                  <Text variant="heading">
                    {label}
                    <span className="ml-2 font-normal text-base text-muted-foreground">
                      {`${semesterSpanLabel(group)} · ${count(group.length, "class", "classes")} · ${count(
                        group.reduce(
                          (sum, e) => sum + e.cls.assignments.length,
                          0,
                        ),
                        "assignment",
                        "assignments",
                      )}`}
                    </span>
                  </Text>
                  {/* Cards sit wider apart than the label sits from its
                      group: the heading belongs to the first card, while each
                      card is its own object. One gap for both made a semester
                      read as one undifferentiated column. */}
                  <Stack gap="lg" className="w-full">
                    {group.map((entry) =>
                      entry.kind === "teaching" ? (
                        <ClassCard
                          key={entry.cls.id}
                          {...entry.cls}
                          onChanged={mutate}
                        />
                      ) : (
                        <EnrolledClassCard key={entry.cls.id} cls={entry.cls} />
                      ),
                    )}
                  </Stack>
                </Stack>
              ))}
              {/* Visible even with nothing left (disabled) so the affordance
                  stays discoverable; hidden only on a fully empty hub. */}
              {entries.length > 0 || data?.hasOlder ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  type="button"
                  disabled={isLoading || !data?.hasOlder}
                  title={
                    data?.hasOlder
                      ? "Show the previous semester's classes too"
                      : "No classes older than these"
                  }
                  onClick={() => {
                    autoSkips.current = 0;
                    setOldest(previousSemester(oldest));
                  }}
                >
                  Load {semesterLabel(previousSemester(oldest))}
                </Button>
              ) : null}
            </>
          )}
        </Stack>
      </Loading>
    </Page>
  );
}
