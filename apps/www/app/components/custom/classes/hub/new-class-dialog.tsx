import { Fragment } from "react";
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

/** How roster maps onto GitHub: a term→meaning table, shown before connecting
 *  so a teacher knows what "creating a class" does to their organization. */
const MAPPING = [
  { term: "Class", detail: "The organization you connect." },
  {
    term: "Teachers",
    // Must match InviteTeacherDialog: roster sends the Owner invitation itself
    // (or promotes an enrolled student on the spot), so the teacher never
    // touches GitHub's own invite UI.
    detail:
      "Its Owners. Invite them by GitHub username from the class page — roster sends the Owner invitation.",
  },
  {
    term: "Students",
    detail: "Its Members. They enroll themselves through the class join link.",
  },
  {
    term: "Student work",
    detail:
      "One repository per student or group, created when an assignment is accepted.",
  },
];

/**
 * The "Create a new class" entry point: explains the roster-on-GitHub model
 * (and the security change we make) BEFORE sending the teacher into the
 * GitHub App install flow. Connecting an org otherwise reads as an obscure
 * technical step rather than "create a class".
 *
 * Two trigger surfaces: the page-header button (default) and a dashed ghost
 * card that sits under the class list and IS the empty state when there are
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
            <Button
              variant="outline"
              type="button"
              title="Starts a new class from an organization you own"
            />
          }
        >
          Connect a GitHub organization
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a new class</DialogTitle>
          <DialogDescription>
            A class is a GitHub organization you own. Its people, its
            assignments, and every student repository all live inside that
            organization.
          </DialogDescription>
        </DialogHeader>
        <Stack gap="lg">
          <Stack gap="sm">
            <Text variant="label" className="font-medium">
              How it maps
            </Text>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-5 gap-y-2.5 sm:grid-cols-[8rem_1fr]">
              {MAPPING.map((m) => (
                <Fragment key={m.term}>
                  <Text as="dt" variant="label" className="font-medium">
                    {m.term}
                  </Text>
                  <Text as="dd" variant="body2" className="m-0">
                    {m.detail}
                  </Text>
                </Fragment>
              ))}
            </dl>
          </Stack>

          {/* Everything about who can see and do what, folded into one
              paragraph and boxed so it can't be skimmed past. roster locks the
              org on connect: base permission No access, no member repo
              creation, access by per-repo grant only, which is what makes
              student work private. */}
          <Stack gap="sm" className="rounded-lg border border-border p-4">
            <Text variant="label" className="font-medium">
              Who can see and do what
            </Text>
            <Text variant="body2">
              On connect, assignments sets the organization's base permission to{" "}
              <strong>No access</strong> — membership grants nothing on its own.
              Each student reaches only their own assignment repo, never another
              student's, and never your private repositories. roster also turns
              off <strong>member repository creation</strong>, so students can't
              create repos in the organization themselves — every student
              repository is born through assignments. Only{" "}
              <strong>public</strong> repos stay visible, to anyone on the
              internet, so keep confidential material private.
            </Text>
          </Stack>
        </Stack>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
          {/* The one thing to get right in GitHub's picker, kept next to the
              button that sends them there, not buried in the list above. */}
          <Text variant="caption">
            In GitHub's picker, choose an org showing <strong>Install</strong> —
            that creates the class. <em>Request</em> only asks its owners for
            approval.
          </Text>
          <Button
            title="Opens GitHub to pick the organization and install the roster App"
            render={<a href={githubAppInstallUrl} />}
          >
            Connect an organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
