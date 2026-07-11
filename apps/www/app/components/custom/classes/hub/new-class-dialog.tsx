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

/** How labs maps onto GitHub — a term→meaning table, shown before connecting so
 *  a teacher knows exactly what "creating a class" does to their organization. */
const MAPPING = [
  { term: "Class", detail: "The organization you connect." },
  {
    term: "Teachers",
    // labs has no way to make someone a teacher: the only org-membership write
    // in the app invites as `member`, and every teacher check is a live
    // isOrgAdmin call. Say so here, or a teacher hunts for a button that will
    // never exist.
    detail:
      "Its Owners. Invite them on GitHub, then promote to Owner — labs never changes roles.",
  },
  {
    term: "Students",
    detail: "Its Members. They enroll themselves through the class join link.",
  },
  {
    term: "Student work",
    detail:
      "One repository per student or group, created when a lab is accepted.",
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
            A class is a GitHub organization you own. Its people, its labs, and
            every student repository all live inside that organization.
          </DialogDescription>
        </DialogHeader>
        <Stack gap="lg">
          <Stack gap="sm">
            <Text variant="overline">How it maps</Text>
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

          {/* The safety-critical part: everything about who can see what,
              folded into one paragraph and boxed so it can't be skimmed past.
              labs sets base permission to No access on connect; access is
              per-repo grant only, which is what makes student work private. */}
          <Stack gap="sm" className="rounded-lg border bg-muted/40 p-4">
            <Text variant="overline">Who can see what</Text>
            <Text variant="body2">
              On connect, labs sets the organization's base permission to{" "}
              <strong>No access</strong> — membership grants nothing on its own.
              Each student reaches only their own lab repo, never another
              student's, and never your private repositories. Only{" "}
              <strong>public</strong> repos stay visible, to anyone on the
              internet, so keep confidential material private.
            </Text>
          </Stack>
        </Stack>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
          {/* The one thing to get right in GitHub's picker, kept next to the
              button that sends them there rather than buried in the list above. */}
          <Text variant="caption">
            In GitHub's picker, choose an org showing <strong>Install</strong> —
            that creates the class. <em>Request</em> only asks its owners for
            approval.
          </Text>
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
