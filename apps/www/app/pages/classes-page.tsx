import { ClassCard } from "~/components/custom/classes/hub/class-card";
import { EnrolledClassCard } from "~/components/custom/classes/hub/enrolled-class-card";
import { NewClassDialog } from "~/components/custom/classes/hub/new-class-dialog";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { api, type ClassItem, type EnrolledClassItem, useApi } from "~/lib/api";
import { semesterLabel, semesterOf } from "~/lib/semester";

function count(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** One hub entry — a class the caller teaches or one they're enrolled in.
 *  Both carry createdAt + labs, which is all grouping needs. */
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

/** The hub: classes the caller teaches (live, with actions) and classes
 *  they're enrolled in (read-only, from the enrollment cache), together
 *  under semester headings. */
export function ClassesPage() {
  const { data, isLoading, error } = useApi(api.api.classes);
  const entries: Entry[] = [
    ...(data?.classes ?? []).map((cls) => ({ kind: "teaching", cls }) as const),
    ...(data?.enrolled ?? []).map(
      (cls) => ({ kind: "enrolled", cls }) as const,
    ),
  ];

  return (
    <Page>
      <Row justify="between" className="w-full">
        <Text variant="heading">Classes</Text>
        <NewClassDialog />
      </Row>
      <Loading loading={isLoading} label="Loading classes…">
        <Stack gap="lg" className="w-full">
          {error ? (
            <Text variant="error">
              Couldn't load your classes — refresh to retry.
            </Text>
          ) : (
            <>
              {groupBySemester(entries).map(([label, group]) => (
                <Stack key={label} gap="md" className="w-full">
                  <Text variant="overline">
                    {`${label} · ${count(group.length, "class", "classes")} · ${count(
                      group.reduce((sum, e) => sum + e.cls.labs.length, 0),
                      "lab",
                      "labs",
                    )}`}
                  </Text>
                  {group.map((entry) =>
                    entry.kind === "teaching" ? (
                      <ClassCard key={entry.cls.id} {...entry.cls} />
                    ) : (
                      <EnrolledClassCard key={entry.cls.id} cls={entry.cls} />
                    ),
                  )}
                </Stack>
              ))}
              {/* Doubles as the empty state: with zero classes it's the only
                  thing on the paper — an invitation to act. */}
              <NewClassDialog variant="card" />
            </>
          )}
        </Stack>
      </Loading>
    </Page>
  );
}
