import { ClassCard } from "~/components/custom/classes/class-card";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Loading } from "~/components/custom/loading";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { githubAppInstallUrl } from "~/lib/config";
import { dummyClassMeta } from "~/lib/dummy";

/** The teacher hub: connect orgs + the live list of connected classes. */
export function ClassesPage() {
  const { data, isLoading, error } = useApi(api.api.classes);
  const classes = data?.classes ?? [];

  return (
    <Stack gap="lg" align="start" className="flex-1 pt-2">
      <Row justify="between" className="w-full">
        <Text variant="heading">Classes</Text>
        <Button render={<a href={githubAppInstallUrl} />}>
          Connect an organization
        </Button>
      </Row>
      <Loading loading={isLoading} label="Loading classes…">
        <Stack gap="md" className="w-full">
          {error ? (
            <Text variant="error">
              Couldn't load your classes — refresh to retry.
            </Text>
          ) : classes.length === 0 ? (
            <Text variant="body2">
              Connect a GitHub organization to start a class.
            </Text>
          ) : (
            classes.map((cls) => (
              // Dummy meta spread swaps to real data as F5 (people)/F6
              // (labs)/F8 (progress) land.
              <ClassCard key={cls.id} {...cls} {...dummyClassMeta(cls.login)} />
            ))
          )}
        </Stack>
      </Loading>
    </Stack>
  );
}
