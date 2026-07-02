import { BrandHeader } from "~/components/custom/brand-header";
import { ClassCard } from "~/components/custom/class-card";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { api, useApi } from "~/lib/api";
import { useAuth } from "~/lib/auth-context";
import { githubAppInstallUrl } from "~/lib/config";

/** The signed-in home. Identity/sign-out live in the top-right AppHeader menu. */
export function HomePage() {
  const { account } = useAuth();
  const { data } = useApi(api.api.classes);

  if (!account) {
    return null;
  }

  const firstName = account.name.split(/\s+/)[0];
  const classes = data?.classes ?? [];

  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <BrandHeader title={`Welcome, ${firstName}`} />
      <Text variant="subtitle" className="max-w-md">
        Your classes and labs will appear here.
      </Text>
      <Button
        size="lg"
        onClick={() => {
          window.location.href = githubAppInstallUrl;
        }}
      >
        Connect a GitHub organization
      </Button>
      <Stack gap="md" className="w-full">
        {classes.length === 0 ? (
          <Text variant="body2">
            No classes yet — connect one to get started.
          </Text>
        ) : (
          classes.map((cls) => <ClassCard key={cls.id} {...cls} />)
        )}
      </Stack>
    </Stack>
  );
}
