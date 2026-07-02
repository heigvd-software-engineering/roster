import { ClassCard } from "~/components/custom/class-card";
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
      <Stack gap="sm" align="start">
        <Text variant="title">Classes</Text>
        <div className="h-1 w-16 bg-brand" />
      </Stack>
      <Button
        size="lg"
        onClick={() => {
          window.location.href = githubAppInstallUrl;
        }}
      >
        Connect an organization
      </Button>
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
