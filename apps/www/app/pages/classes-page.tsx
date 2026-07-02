import { ClassCard } from "~/components/custom/classes/class-card";
import { Row } from "~/components/custom/layout/row";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { githubAppInstallUrl } from "~/lib/config";

/** The teacher hub: connect orgs + the live list of connected classes. */
export function ClassesPage() {
  const { data } = useApi(api.api.classes);
  const classes = data?.classes ?? [];

  return (
    <Stack gap="lg" align="start" className="flex-1 pt-2">
      <Row justify="between" className="w-full">
        <Text variant="title" className="text-2xl md:text-3xl">
          Classes
        </Text>
        <Button
          onClick={() => {
            window.location.href = githubAppInstallUrl;
          }}
        >
          Connect an organization
        </Button>
      </Row>
      <Stack gap="md" className="w-full">
        {classes.length === 0 ? (
          <Text variant="body2">
            Connect a GitHub organization to start a class.
          </Text>
        ) : (
          classes.map((cls) => <ClassCard key={cls.id} {...cls} />)
        )}
      </Stack>
    </Stack>
  );
}
