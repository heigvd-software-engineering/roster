import { ClassCard } from "~/components/custom/classes/class-card";
import { NewClassDialog } from "~/components/custom/classes/new-class-dialog";
import { Page } from "~/components/custom/layout/page";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { api, type ClassItem, useApi } from "~/lib/api";
import { semesterLabel, semesterOf } from "~/lib/semester";

function count(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Classes bucketed by the semester they were created in. The API returns
 *  them newest-first, so first-appearance order = newest semester first —
 *  a Map preserves it. */
function groupBySemester(classes: ClassItem[]) {
  const groups = new Map<string, ClassItem[]>();
  for (const cls of classes) {
    const label = semesterLabel(semesterOf(new Date(cls.createdAt)));
    const group = groups.get(label) ?? [];
    group.push(cls);
    groups.set(label, group);
  }
  return [...groups.entries()];
}

/** The teacher hub: connect orgs + the live list of connected classes,
 *  grouped by semester. */
export function ClassesPage() {
  const { data, isLoading, error } = useApi(api.api.classes);
  const classes = data?.classes ?? [];

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
              {groupBySemester(classes).map(([label, group]) => (
                <Stack key={label} gap="md" className="w-full">
                  <Text variant="overline">
                    {`${label} · ${count(group.length, "class", "classes")} · ${count(
                      group.reduce((sum, cls) => sum + cls.labs.length, 0),
                      "lab",
                      "labs",
                    )}`}
                  </Text>
                  {group.map((cls) => (
                    <ClassCard key={cls.id} {...cls} />
                  ))}
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
