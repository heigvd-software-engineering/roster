import type { ReactElement } from "react";
import { ConfirmDialog } from "~/components/custom/confirm-dialog";
import { Stack } from "~/components/custom/layout/stack";
import { Text } from "~/components/custom/typography/text";
import { count } from "~/lib/format";

/**
 * The app's ONE deletion gate. Every delete goes through it, and every delete
 * asks the same thing: read what goes, then type the name out.
 *
 * There is deliberately no second, gentler variant and no server-side refusal
 * behind it. Deleting a group used to be refused once its work repository
 * existed, which read as a guarantee it never was, since deleting the
 * assignment above it took the same group anyway. One rule the teacher can
 * state from memory beats two that disagree.
 *
 * The ceremony is affordable because the loss is bounded: nothing in roster
 * ever deletes a GitHub repository. Build `stakes` from the sentences below
 * rather than writing fresh ones — what survives is as much a part of the
 * decision as what doesn't, and it must read the same on every screen.
 */
export function DeleteDialog({
  trigger,
  open,
  onOpenChange,
  what,
  name,
  stakes,
  onDelete,
}: {
  /** The button that opens it. Omitted in controlled mode, for triggers that
   *  unmount on click (a menu item). */
  trigger?: ReactElement | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** The noun, for the confirm button: "assignment", "group". */
  what: string;
  /** The thing's own name, shown in the question and typed to confirm. */
  name: string;
  /** What this deletion takes, and what it leaves — one line each, in the
   *  order the person would ask about them. */
  stakes: string[];
  onDelete: () => void | Promise<void>;
}) {
  return (
    <ConfirmDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete "${name}"?`}
      description="This can't be undone."
      confirmLabel={`Delete ${what}`}
      requireText={name}
      onConfirm={onDelete}
    >
      <Stakes lines={stakes} />
    </ConfirmDialog>
  );
}

/**
 * The sentences every deletion is made of, written once. Two callers state the
 * same promise about GitHub Teams and work repositories, and the promise is the
 * whole reason the gate is only a gate — so it lives here, beside the dialog
 * that exists to deliver it, not in each page's own words.
 */
export const STAKES = {
  /** The roster only ever lived in the team, so this is the real loss. */
  team: "Its GitHub team goes with it, and a team holds its own roster, so nothing here brings it back.",
  teams: (groups: number) =>
    `${count(groups, "group")} and their GitHub teams go with it. A team holds its own roster, so nothing here brings it back.`,
  students: (n: number, where: string) =>
    `${count(n, "student")} lose ${where}.`,
  /** The one thing a deletion never takes. `subject` names it: a repo's full
   *  name when there is one, "N work repositories" when counting. */
  reposSurvive: (subject: string, plural = false) =>
    `${subject} ${plural ? "stay" : "stays"} in the organisation — roster never deletes student work — but the students lose their access along with the team.`,
  /** How the work is reached again. NOT automatic, and not the create button:
   * `createWorkRepo` never adopts an existing repo (it answers `name_taken`),
   * so the route back is the `work-repos` reconciler on the GitHub sync page.
   * */
  reposReturn:
    "Recreate a group under the same name here and the class's GitHub sync offers to link that repository back to it.",
} as const;

/** The consequences, bulleted. */
function Stakes({ lines }: { lines: string[] }) {
  return (
    <Stack gap="xs">
      {lines.map((line) => (
        <Text
          key={line}
          variant="body2"
          className="before:mr-1.5 before:content-['—']"
        >
          {line}
        </Text>
      ))}
    </Stack>
  );
}
