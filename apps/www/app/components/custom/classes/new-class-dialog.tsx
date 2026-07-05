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
    detail: "Every Owner of the organization manages the class.",
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
 */
export function NewClassDialog() {
  const { githubAppInstallUrl } = useAuth();
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Create a new class</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
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
        </Stack>
        <DialogFooter>
          <Button render={<a href={githubAppInstallUrl} />}>
            Connect an organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
