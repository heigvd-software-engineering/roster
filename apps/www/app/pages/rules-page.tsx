import { Anchor, CalendarClock, Flag, Lock, Users } from "lucide-react";
import { Page } from "~/components/custom/layout/page";
import { Stack } from "~/components/custom/layout/stack";
import { Axiom, Axioms } from "~/components/custom/rules/axiom";
import { RuleItem } from "~/components/custom/rules/rule-item";
import { RulePhase } from "~/components/custom/rules/rule-phase";
import { Text } from "~/components/custom/typography/text";

/**
 * /rules — the laws of lab orchestration, on one page, identical for
 * students and teachers: students learn their boundaries, teachers see
 * their powers spelled out next to them. Axioms first (the overview), then
 * the phases of a lab's life as a timeline. Every rule here is ENFORCED
 * server-side (the named 409s in the group handlers); this page documents,
 * it doesn't decide.
 */
export function RulesPage() {
  return (
    <Page>
      <Stack gap="lg" className="w-full">
        <Stack gap="none">
          <Text variant="heading">How roster works</Text>
          <Text variant="subtitle">
            The rules of groups and repositories — one page, the same for
            students and teachers.
          </Text>
        </Stack>

        <Axioms>
          <Axiom marker="A1" name="The repository is the point of no return">
            A group without one is a plan; the moment it exists, the group is a
            deliverable — and the rules change.
          </Axiom>
          <Axiom marker="A2" name="Time binds students, never the teacher">
            Before the start and once a repository exists, students are
            restricted — the teacher never is. Structural rules — sizes, one
            group per lab — bind everyone.
          </Axiom>
          <Axiom marker="A3" name="Exceptions change the lab, not the group">
            Need a bigger group? The lab's limit changes — for every group,
            visibly. No group quietly becomes special.
          </Axiom>
          <Axiom marker="A4" name="The rules are enforced, not suggested">
            Every rule on this page is checked by the server. A missing or
            disabled button is a rule at work — going around the interface
            doesn't change the answer.
          </Axiom>
        </Axioms>

        <Stack gap="none" className="w-full">
          <RulePhase
            icon={CalendarClock}
            step="01"
            title="Before the start"
            tagline="A lab is visible from the moment it's created — but quiet until its start date."
          >
            <RuleItem who="students">
              You can see the lab and its dates, but nothing can be done yet —
              no groups, no repository.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can prepare at any time: create groups and place
              people before the lab starts.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can even create the repositories ahead of the start.
              A group that begins with its repository is frozen from day one —
              this is how a lab with teacher-chosen groups is run: students
              arrive, everything is already set.
            </RuleItem>
          </RulePhase>

          <RulePhase
            icon={Users}
            step="02"
            title="Forming groups"
            tagline="Between the start and the repository, groups are free to change."
          >
            <RuleItem who="students">
              You organize yourselves: create a group, join one, leave one —
              always for yourself, never for someone else.
            </RuleItem>
            <RuleItem who="everyone">
              One group per person per lab. No exceptions — the rule binds the
              teacher's placements too.
            </RuleItem>
            <RuleItem who="everyone">
              Group size is the lab's rule: nobody can overfill a group, the
              teacher included. Limits change on the lab, for all groups at
              once.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can delete a group — as long as it has no repository.
            </RuleItem>
            <RuleItem who="students">
              In an individual lab there is nothing to form: accepting it
              creates your solo group and its repository in one click.
            </RuleItem>
          </RulePhase>

          <RulePhase
            icon={Lock}
            step="03"
            pivotal
            title="Creating the repository"
            tagline="The point of no return: the repository turns a group into a deliverable."
          >
            <RuleItem who="students">
              The repository can be created once the group reaches the lab's
              minimum size. You confirm explicitly — creating it freezes the
              group.
            </RuleItem>
            <RuleItem who="students">
              From that moment the group is frozen for students: no joining, no
              leaving, no deleting.
            </RuleItem>
            <RuleItem who="teacher">
              The teacher can still reshape any group at any time — add,
              remove, or move people — and can create a group's repository, or
              every missing one at once.
            </RuleItem>
            <RuleItem who="everyone">
              A group with a repository is never deleted, by anyone. The work
              is preserved; the roster can be emptied and moved instead.
            </RuleItem>
            <RuleItem who="teacher">
              If the repository was deleted on GitHub itself, the teacher can
              unlink it — the group opens up and the forming rules apply again.
            </RuleItem>
          </RulePhase>

          <RulePhase
            icon={Flag}
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
            icon={Anchor}
            step="∞"
            title="At every moment"
            tagline="True through a lab's whole life."
          >
            <RuleItem who="everyone">
              GitHub is the ground truth: groups are teams, work lives in
              repositories named after the lab and the group, all in the class
              organization.
            </RuleItem>
          </RulePhase>
        </Stack>
      </Stack>
    </Page>
  );
}
