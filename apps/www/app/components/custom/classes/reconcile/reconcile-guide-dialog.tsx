import { Info } from "lucide-react";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";

/**
 * The catalogue of what reconcile can find and what Apply does about each: one
 * entry per drift the subsystem recognises, grouped by the SAME sections the
 * reconcile page uses (what the class IS → who is in it → what they work in →
 * who can see what). Prose, deliberately: the reconcilers' own titles are
 * generated per finding, so there is no static list to render. Each
 * reconciler's header comment is the source of truth for "what does this
 * cover", and this mirrors it. Adding a reconciler means adding an entry here.
 */
const GUIDE: {
  section: string;
  note?: string;
  items: { what: string; handled: string }[];
}[] = [
  {
    section: "Class",
    items: [
      {
        what: "The class points at an old GitHub App installation",
        handled:
          "Reinstalling the App mints a new id. Reconcile repoints the class at the current one, so students and lab pages can reach it again.",
      },
      {
        what: "The organization was renamed, or its name or avatar changed",
        handled: "Reconcile refreshes the cached class card to match GitHub.",
      },
    ],
  },
  {
    section: "Roster",
    note: "roster keeps its own list of a class's members — a cache of GitHub's org membership, used to show who's in the class without calling GitHub every time. Access is always live from GitHub, so reconciling this list never grants or revokes anything; it just keeps the list honest.",
    items: [
      {
        what: "Someone joined the organization but isn't on the class list",
        handled:
          "Added to the list — as a student, or as a teacher if they're an Owner.",
      },
      {
        what: "A member became an Owner, or an Owner is no longer one",
        handled:
          "The list re-labels them teacher or student to match. Access is live from GitHub either way — an Owner can act as a teacher immediately, reconcile or not.",
      },
      {
        what: "A member changed their login or avatar",
        handled: "Their details are refreshed.",
      },
      {
        what: "A member left the organization",
        handled: "Removed from the class list.",
      },
    ],
  },
  {
    section: "Groups",
    items: [
      {
        what: "A group's GitHub Team was deleted",
        handled:
          "The group is dropped from its lab. Its work repository is kept and re-attaches on its own if you recreate the group with the same name.",
      },
      {
        what: "A group's team roster was edited outside labs, or never recorded",
        handled:
          "Reconcile copies the GitHub team roster into the group. The team — the real membership and repo access — is never touched.",
      },
      {
        what: "A work repository exists but was never linked to its group",
        handled:
          "If accepting a lab is interrupted after GitHub makes the repo but before roster records it. Re-accepting the lab already self-heals; reconcile is the backstop — it links the repo and re-grants the team its push access.",
      },
    ],
  },
  {
    section: "Security",
    items: [
      {
        what: "The organization's base permission is no longer No access",
        handled:
          "Every member could then read every repository, including other groups' work. Reconcile sets it back to No access — leaving it unfixed is the real hazard.",
      },
      {
        what: "Members can create repositories in the organization",
        handled:
          "Students could then create repos directly on GitHub, outside the roster workflow. Reconcile turns member repository creation back off — student repositories are born through roster only.",
      },
    ],
  },
];

/**
 * "What does reconcile cover?", an on-demand reference for the reconcile page.
 * The audit lists what has drifted RIGHT NOW; this lists everything the
 * subsystem can ever notice and how it repairs each, so a teacher can trust an
 * empty audit and know what an Apply will and won't do. A quiet link, not a
 * banner: it earns its space only when someone asks.
 */
export function ReconcileGuideDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground text-sm underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
          />
        }
      >
        <Info className="size-3.5" />
        What does reconcile cover?
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What reconcile covers</DialogTitle>
          <DialogDescription>
            Every kind of drift the audit can find, and what Apply does about
            it. The audit only reads — nothing here is changed until you apply
            it, and every fix is safe to run twice.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="lg">
          {GUIDE.map((group) => (
            <Stack gap="sm" key={group.section}>
              <Text variant="overline">{group.section}</Text>
              {group.note ? (
                <Text variant="caption" className="-mt-1">
                  {group.note}
                </Text>
              ) : null}
              <Stack gap="md" className="w-full">
                {group.items.map((item) => (
                  <Stack gap="none" key={item.what} className="min-w-0">
                    <Text variant="label" className="font-medium">
                      {item.what}
                    </Text>
                    <Text variant="body2">{item.handled}</Text>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          ))}

          {/* The one guarantee that isn't a per-row fix: a broken check
              reports itself instead of taking the page down with it. */}
          <Text variant="caption" className="border-t pt-3">
            A check that can't run — say the App was removed from the
            organization — is reported on its own and never blocks the others.
          </Text>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
