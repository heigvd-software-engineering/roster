import { Link, useSearchParams } from "react-router";
import { Page } from "~/components/custom/layout/page";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { useAuth } from "~/contexts/auth-context";
import { cn } from "~/lib/utils";

/** Every way the connect flow dies, in user words. `key` matches the setup
 *  callback's `/?error=…` codes; `member` has NO code — GitHub bounces a
 *  member's install "Request" back without ever calling us, so it can only
 *  be explained, never detected. That case is WHY this page lists every
 *  cause instead of echoing one. */
const CAUSES: { key: string; title: string; detail: string }[] = [
  {
    key: "member",
    title: "You're only a Member of the organization",
    detail:
      'In GitHub\'s picker, organizations you own show "Install" — that\'s the button that creates the class. Where you\'re only a member it shows "Request", which files an approval with the owners and never creates a class. Ask an owner to promote you, or use an organization you own.',
  },
  {
    key: "not_an_org",
    title: "The App was installed on a personal account",
    detail:
      "A class is backed by a GitHub organization. Pick an organization in GitHub's picker — not your personal account.",
  },
  {
    key: "not_your_installation",
    title: "Installed with a different GitHub account",
    detail:
      "The installation was made by a GitHub account other than the one linked to labs. Redo it while signed in to GitHub as the account you linked.",
  },
  {
    key: "github_not_linked",
    title: "Your GitHub account isn't linked",
    detail:
      "Connecting a class needs a linked GitHub account. Link it first, then connect the organization again.",
  },
  {
    key: "no_installation",
    title: "GitHub didn't report an installation",
    detail:
      "The install flow ended without an installation id — usually a cancelled or interrupted install. Run it again from start to finish.",
  },
];

/**
 * /classes/connect-failed?reason=… — where the connect-a-class flow lands
 * when no class came out of it. The reported reason (when the setup
 * callback had one) leads, highlighted; every other cause stays visible
 * because the most common one (member, not owner) reaches us with no
 * signal at all.
 */
export function ConnectFailedPage() {
  const [searchParams] = useSearchParams();
  const { githubAppInstallUrl } = useAuth();
  const reason = searchParams.get("reason");

  const known = CAUSES.some((c) => c.key === reason);
  const causes = known
    ? [
        ...CAUSES.filter((c) => c.key === reason),
        ...CAUSES.filter((c) => c.key !== reason),
      ]
    : CAUSES;

  return (
    <Page>
      <Stack gap="lg" className="w-full max-w-2xl">
        <Stack gap="none">
          <Text variant="heading">The organization didn't connect</Text>
          <Text variant="subtitle">
            The GitHub step finished, but no class was created. The usual
            causes,{" "}
            {known ? "starting with what we saw:" : "most common first:"}
          </Text>
        </Stack>

        <Stack gap="sm" className="w-full">
          {causes.map((cause, i) => {
            const matched = known && i === 0;
            return (
              <Card
                key={cause.key}
                className={cn(
                  "w-full gap-1 border-l-2 p-4",
                  matched ? "border-l-warning" : "border-l-transparent",
                )}
              >
                <Text variant="label" className="font-medium">
                  {cause.title}
                  {matched ? (
                    <span className="ml-2 font-mono text-warning text-xs">
                      this is what happened
                    </span>
                  ) : null}
                </Text>
                <Text variant="body2">{cause.detail}</Text>
              </Card>
            );
          })}
        </Stack>

        <Stack gap="sm" align="start">
          <Button
            title="Opens GitHub to pick the organization and install the labs App"
            render={<a href={githubAppInstallUrl} />}
          >
            Try connecting again
          </Button>
          <Link to="/classes" className="text-sm underline">
            ‹ Back to classes
          </Link>
        </Stack>
      </Stack>
    </Page>
  );
}
