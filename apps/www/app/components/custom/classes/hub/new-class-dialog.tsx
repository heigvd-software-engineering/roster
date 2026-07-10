import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useAuth } from "~/contexts/auth-context";

/** How labs maps onto GitHub — shown before connecting, so a teacher knows
 *  exactly what "creating a class" does to their organization. */
const MAPPING = [
  {
    term: "Class = GitHub organization",
    detail: "Each class is backed by one organization you own.",
  },
  {
    term: "Teachers = organization Owners",
    // labs has no way to make someone a teacher: the only org-membership write
    // in the app invites as `member`, and every teacher check is a live
    // isOrgAdmin call. Say so here, or a teacher hunts for a button that will
    // never exist.
    detail:
      "Every Owner of the organization manages the class. To add a teacher, invite them to the organization on GitHub and promote them to Owner — labs never changes roles.",
  },
  {
    term: "Students = organization Members",
    detail: "Students enroll themselves through the class join link.",
  },
  {
    term: "Student work = repositories",
    detail:
      "Accepting a lab creates a student lab repo inside the organization, one per student or group.",
  },
];

/**
 * The "Create a new class" entry point: explains the labs-on-GitHub model
 * (and the security change we make) BEFORE sending the teacher into the
 * GitHub App install flow — connecting an org otherwise reads as an obscure
 * technical step rather than "create a class".
 *
 * Two trigger surfaces: the page-header button (default) and a dashed ghost
 * card that sits under the class list — and IS the empty state when there are
 * no classes yet.
 */
export function NewClassDialog({
  variant = "button",
}: {
  variant?: "button" | "card";
}) {
  const { githubAppInstallUrl } = useAuth();
  return (
    <Dialog>
      {variant === "button" ? (
        <DialogTrigger
          render={
            <Button title="Connect a GitHub organization as a new class" />
          }
        >
          New class
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <button
              type="button"
              className="group w-full cursor-pointer rounded-xl border-2 border-border border-dashed px-5 py-6 text-center transition-colors hover:border-muted-foreground/60"
            />
          }
        >
          <span className="block font-medium text-muted-foreground text-sm transition-colors group-hover:text-foreground">
            + Connect a GitHub organization
          </span>
          <span className="block text-muted-foreground/80 text-xs">
            Starts a new class from an organization you own
          </span>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a new class</DialogTitle>
          <DialogDescription>
            In labs, a class is a GitHub organization. To create a class, you
            connect an organization you own, and labs runs everything inside it
            — people, labs, and student lab repos. Here is how the pieces map:
          </DialogDescription>
        </DialogHeader>
        <Stack gap="md">
          {MAPPING.map((m) => (
            <Stack gap="none" key={m.term}>
              <Text variant="label" className="font-medium">
                {m.term}
              </Text>
              <Text variant="body2">{m.detail}</Text>
            </Stack>
          ))}
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              One security change
            </Text>
            <Text variant="body2">
              After you pick the organization, labs sets its base repository
              permission to <strong>No access</strong>: being a member grants
              access to nothing by itself. Students only reach the repositories
              they are explicitly granted.
            </Text>
          </Stack>
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              Students never see each other's work
            </Text>
            <Text variant="body2">
              Each student (or group) is granted access to their own lab repo
              only. GitHub hides repositories you have no permission on, so one
              student's repo is invisible to every other student and group.
            </Text>
          </Stack>
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              Your existing repositories stay hidden
            </Text>
            <Text variant="body2">
              Students are Members, not Owners: the organization's private
              repositories stay invisible to them unless you grant access
              yourself. Only public repositories remain visible — to anyone on
              the internet — so keep confidential material private.
            </Text>
          </Stack>
          <Stack gap="none">
            <Text variant="label" className="font-medium">
              Pick an organization showing "Install"
            </Text>
            <Text variant="body2">
              GitHub's picker lists every organization you belong to.
              Organizations you <strong>own</strong> show{" "}
              <strong>Install</strong> — that's the button that creates the
              class. Where you're only a member it shows <em>Request</em>, which
              files an approval with the owners and never creates a class.
            </Text>
          </Stack>
        </Stack>
        <DialogFooter>
          <Button
            title="Opens GitHub to pick the organization and install the labs App"
            render={<a href={githubAppInstallUrl} />}
          >
            Connect an organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
