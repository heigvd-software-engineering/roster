import { Page } from "~/components/custom/layout/page";
import { Stack } from "~/components/custom/layout/stack";
import { Axiom, Axioms } from "~/components/custom/rules/axiom";
import { ConnectAssistant } from "~/components/custom/rules/connect-assistant";
import { RuleItem } from "~/components/custom/rules/rule-item";
import { RulePhase } from "~/components/custom/rules/rule-phase";
import { Text } from "~/components/custom/typography/text";

/**
 * /rules: what a student and a teacher may do, on one page, in the words the
 * app itself uses. Students learn their boundaries, teachers see their powers
 * spelled out beside them.
 *
 * Two switches decide everything the page describes, so it names them before
 * anything else: the START DATE opens the assignment for students, and the
 * WORK REPOSITORY locks their group. They are independent, which is why the
 * phases below are not a straight timeline. A group can be locked before the
 * assignment opens (the teacher's own groups) and the deadline flips neither
 * switch: no handler reads it, so nothing closes.
 *
 * The server refuses every restriction stated here (the named 409s in the
 * group handlers), so this page documents, it doesn't decide. Deletion is the
 * one rule no handler can check: `DeleteDialog` holds that gate, and the
 * server carries out what it confirms.
 */
export function RulesPage() {
  return (
    <Page>
      <Stack gap="lg" className="w-full">
        <Stack gap="none">
          <Text variant="title">How roster works</Text>
          <Text variant="subtitle">
            What you can do, when, and why a button is sometimes greyed out.
          </Text>
        </Stack>

        <Axioms title="Start here">
          <Axiom name="Assignment">
            One piece of work your teacher sets, with a deadline. It can also
            have a start date, and students can do nothing with it before then.
          </Axiom>
          <Axiom name="Group">
            The classmates you do one assignment with. A group belongs to that
            assignment alone, so the next assignment starts over.
          </Axiom>
          <Axiom name="Work repository">
            The private GitHub repository your group pushes to, one per group.
            Creating it is the step you can't undo: it locks the group.
          </Axiom>
          <Axiom name="Your teacher">
            Never held back by the start date or by the repository. Group sizes
            and one-group-each bind everyone, the teacher included.
          </Axiom>
        </Axioms>

        <Stack gap="lg" className="w-full">
          <RulePhase
            step="01"
            title="Before the start date"
            tagline="The assignment appears in your list right away, marked Not started."
          >
            <RuleItem who="students">
              You can open it and read its dates. You can't make a group or get
              any code yet.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can already do everything: make groups and put people
              in them, before anyone arrives.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can even create the work repositories early. A group
              that starts out with its repository is locked from day one, which
              is how an assignment with teacher-chosen groups runs.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="02"
            title="Making your group"
            tagline="From the start date until your group creates its work repository. Nothing is fixed yet."
          >
            <RuleItem who="students">
              Every group shows its members and its open seats. Taking an open
              seat is how you join, and you can leave the same way. You only
              ever move yourself, never a classmate.
            </RuleItem>
            <RuleItem who="students">
              No group that suits you? Make one, and you are in it right away.
            </RuleItem>
            <RuleItem who="everyone">
              One group per person per assignment. This binds the teacher's
              placements too.
            </RuleItem>
            <RuleItem who="everyone">
              The assignment sets the smallest and largest group, and nobody can
              overfill one, the teacher included. To make room, the teacher
              raises the limit on the assignment and every group gets it.
            </RuleItem>
            <RuleItem who="students">
              An individual assignment has no group to make. One click on Accept
              assignment gives you your own repository.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can delete a group, or the whole assignment. Deleting
              asks for the thing's name, and lists what goes and what stays.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="03"
            title="Creating the work repository"
            tagline="The step you can't undo. Anyone in the group can take it, once the group is big enough."
          >
            <RuleItem who="students">
              When your group reaches the assignment's smallest size, a Create
              repository button appears. It asks you to confirm, because this
              locks the group. Make sure everyone is in first.
            </RuleItem>
            <RuleItem who="students">
              After that, Join and Leave stop working for the whole group. The
              buttons say why: ask your teacher.
            </RuleItem>
            <RuleItem who="teacher">
              The lock leaves the teacher alone. The teacher can still add,
              remove and move people, and can create one group's repository or
              every missing one at once.
            </RuleItem>
            <RuleItem who="everyone">
              roster never deletes a GitHub repository. Delete a group, delete
              the whole assignment, and the code still sits in the class
              organization. What goes is the GitHub team, and with it everyone's
              access to the code.
            </RuleItem>
            <RuleItem who="teacher">
              Make a group with the same name again and the class's GitHub sync
              offers to link its old repository back to it.
            </RuleItem>
            <RuleItem who="teacher">
              If someone deleted the repository on GitHub itself, the teacher
              can unlink it. The group then behaves like one that never had a
              repository.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="04"
            title="After the deadline"
            tagline="The deadline sorts the work. It closes nothing."
          >
            <RuleItem who="everyone">
              Nothing shuts off at the deadline. You can still push, and you can
              still clone.
            </RuleItem>
            <RuleItem who="teacher">
              The assignment reads Done, and any group whose last push came
              after the deadline shows up as late on the teacher's page.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="∞"
            title="Always true"
            tagline="True at every moment of an assignment."
          >
            <RuleItem who="everyone">
              GitHub holds the truth. Your group is a GitHub team, and your work
              is in a repository named after the assignment and the group, both
              inside your class's organization.
            </RuleItem>
          </RulePhase>
        </Stack>

        <ConnectAssistant />
      </Stack>
    </Page>
  );
}
