import { useSearchParams } from "react-router";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/contexts/auth-context";

/** Onboarding gate: link GitHub before using the app. */
export function OnboardingGitHubPage() {
  const { linkGithub } = useAuth();
  const [params] = useSearchParams();
  const raw = params.get("returnTo") ?? "/";
  // Same-app absolute paths only: "//host" is scheme-relative, and browsers
  // normalize "\" to "/" (so "/\host" becomes one too). Both open redirects.
  const returnTo =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")
      ? raw
      : "/";
  // Two `error` params arrive on failure: our own `link_failed` marker (from
  // errorCallbackURL) plus the real cause Better Auth appends (invalid_code,
  // unable_to_get_user_info, …).
  const errors = params.getAll("error");
  const failed = errors.length > 0;
  const cause = errors.find((e) => e !== "link_failed");
  // These two usually mean GitHub withheld the profile (user-fixable), but
  // unable_to_get_user_info is ambiguous: GitHub's token endpoint answers
  // HTTP 200 with an error body on bad client credentials, so Better Auth
  // only notices at the profile fetch and emits the same code. Anything else
  // (invalid_code, state_mismatch, …) is squarely on our side.
  const profileWithheld =
    cause === undefined ||
    cause === "unable_to_get_user_info" ||
    cause === "email_not_found";
  return (
    <Stack gap="lg" align="start" justify="center" className="flex-1">
      <Text variant="title">Connect GitHub</Text>
      <Text variant="subtitle" className="max-w-md">
        roster runs your classes and assignments on your own GitHub account.
        Link it to continue.
      </Text>
      {failed ? (
        <Text variant="error" className="max-w-md">
          {cause === "access_denied" ? (
            <>You declined the authorization on GitHub. Link it to continue.</>
          ) : profileWithheld ? (
            <>
              GitHub didn't share your profile
              {cause ? <> ({cause})</> : null}. If the account is new, verify
              its email address on GitHub, then try again. If it keeps
              happening, report it: the problem may be on our side.
            </>
          ) : (
            <>
              Linking failed with an internal error ({cause}). Your GitHub
              account is fine. Try again, and report this if it keeps happening.
            </>
          )}
        </Text>
      ) : null}
      <Button
        size="lg"
        title="Link your GitHub account to roster"
        onClick={() => linkGithub(returnTo)}
      >
        {failed ? "Try connecting again" : "Connect GitHub"}
      </Button>
    </Stack>
  );
}
