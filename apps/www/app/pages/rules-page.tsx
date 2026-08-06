import { Page } from "~/components/custom/layout/page";
import { Stack } from "~/components/custom/layout/stack";
import { Axiom, Axioms } from "~/components/custom/rules/axiom";
import { RuleItem } from "~/components/custom/rules/rule-item";
import { RulePhase } from "~/components/custom/rules/rule-phase";
import { Text } from "~/components/custom/typography/text";

/**
 * /rules: the laws of assignment orchestration, on one page, identical for
 * students and teachers: students learn their boundaries, teachers see their
 * powers spelled out next to them. Axioms first (the overview), then the phases
 * of an assignment's life as a timeline. The server enforces every rule here
 * that can be refused (the named 409s in the group handlers); this page
 * documents, it doesn't decide.
 *
 * The one exception is A4, and it has to be: "did you mean it" is a statement
 * about a person, not about data, so no handler can check it. The deletion
 * gate lives in the dialog (`DeleteDialog`) and the server carries out what it
 * confirms. Say that plainly rather than let A5 overclaim.
 */
export function RulesPage() {
  return (
    <Page>
      <Stack gap="lg" className="w-full">
        <Stack gap="none">
          <Text variant="title">How roster works</Text>
          <Text variant="subtitle">
            The rules of groups and repositories — one page, the same for
            students and teachers.
          </Text>
        </Stack>

        <Axioms>
          <Axiom marker="A1" name="The repository is the point of no return">
            A group without one is a plan; the moment it exists, the group is a
            deliverable — and it freezes for students. The work itself is safe
            either way: roster never deletes a repository.
          </Axiom>
          <Axiom marker="A2" name="Time binds students, never the teacher">
            Before the start and once a repository exists, students are
            restricted — the teacher never is. Structural rules — sizes, one
            group per assignment — bind everyone.
          </Axiom>
          <Axiom
            marker="A3"
            name="Exceptions change the assignment, not the group"
          >
            Need a bigger group? The assignment's limit changes — for every
            group, visibly. No group quietly becomes special.
          </Axiom>
          <Axiom marker="A4" name="Deleting is confirmed, never refused">
            One rule for every deletion: read what it takes, type the thing's
            name, and it's done. Nothing is protected by a locked button
            instead.
          </Axiom>
          <Axiom marker="A5" name="The rules are enforced, not suggested">
            Every rule here that can be refused is checked by the server, so a
            missing or disabled button is a rule at work — going around the
            interface doesn't change the answer. A4 is the exception, and it has
            to be: no server can check whether you meant it.
          </Axiom>
        </Axioms>

        <Stack gap="lg" className="w-full">
          <RulePhase
            step="01"
            title="Before the start"
            tagline="An assignment is visible from the moment it's created — but quiet until its start date."
          >
            <RuleItem who="students">
              You can see the assignment and its dates, but nothing can be done
              yet — no groups, no repository.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can prepare at any time: create groups and place
              people before the assignment starts.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can even create the repositories ahead of the start. A
              group that begins with its repository is frozen from day one —
              this is how an assignment with teacher-chosen groups is run:
              students arrive, everything is already set.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="02"
            title="Forming groups"
            tagline="Between the start and the repository, groups are free to change."
          >
            <RuleItem who="students">
              You organize yourselves: create a group, join one, leave one —
              always for yourself, never for someone else.
            </RuleItem>
            <RuleItem who="everyone">
              One group per person per assignment. No exceptions — the rule
              binds the teacher's placements too.
            </RuleItem>
            <RuleItem who="everyone">
              Group size is the assignment's rule: nobody can overfill a group,
              the teacher included. Limits change on the assignment, for all
              groups at once.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can delete a group, or the whole assignment, by typing
              its name to confirm.
            </RuleItem>
            <RuleItem who="students">
              In an individual assignment there is nothing to form: accepting it
              creates your solo group and its repository in one click.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="03"
            title="Creating the repository"
            tagline="The point of no return: the repository turns a group into a deliverable."
          >
            <RuleItem who="students">
              The repository can be created once the group reaches the
              assignment's minimum size. You confirm explicitly — creating it
              freezes the group.
            </RuleItem>
            <RuleItem who="students">
              From that moment the group is frozen for students: no joining, no
              leaving, no deleting.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can still reshape any group at any time — add, remove,
              or move people — and can create a group's repository, or every
              missing one at once.
            </RuleItem>
            <RuleItem who="everyone">
              A repository is never deleted, by anyone, ever. Not when the group
              goes, not when the assignment goes — the work stays in the
              organization.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can still delete the group, or its assignment, and the
              confirmation says what that costs: the students lose their access
              along with the team. Recreate a group under the same name and the
              class's GitHub sync offers to link its repository back.
            </RuleItem>
            <RuleItem who="teacher">
              If the repository was deleted on GitHub itself, the teacher can
              unlink it — the group opens up and the forming rules apply again.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="04"
            title="After the deadline"
            tagline="The deadline judges the work — it doesn't cut access."
          >
            <RuleItem who="everyone">
              Nothing closes at the deadline: pushing still works, and the work
              is marked late by its last push — visibly, for everyone.
            </RuleItem>
          </RulePhase>

          <RulePhase
            step="∞"
            title="At every moment"
            tagline="True through an assignment's whole life."
          >
            <RuleItem who="everyone">
              GitHub is the ground truth: groups are teams, work lives in
              repositories named after the assignment and the group, all in the
              class organization.
            </RuleItem>
          </RulePhase>
        </Stack>
      </Stack>
    </Page>
  );
}
