// The live org roster vs the `class_members` display cache.
//
// THE only whole-roster observer. Every other write point — observeMember,
// forgetMember, the join POSTs — sees exactly one person: the caller. So this is
// the only thing that can notice someone who joined the org out of band, an
// Owner who was promoted, a login that changed, or a student who left.

import { forgetMember, observeMember } from "../enrollment";
import type { OrgPerson } from "../github/org";
import type {
  AppliedOp,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
  Severity,
} from "./types";

type MemberState = "pending" | "active" | "teacher";

/** "roster:remove:githubId=9" → "9". Findings are content-addressed, so the key
 *  IS the subject: nothing else has to travel from audit to apply. */
const subjectOf = (key: FindingKey) => key.split("githubId=")[1] ?? "";

const TITLES: Record<string, string> = {
  add: "A member is missing from the class roster",
  remove: "A member left the organization",
  promote: "A member became an organization Owner",
  demote: "An Owner is no longer an Owner",
  refresh: "A member's GitHub details changed",
};

const finding = (
  githubId: string,
  op: string,
  severity: Severity,
  destructive: boolean,
  detail: string,
  fix: string,
): Finding => ({
  key: `roster:${op}:githubId=${githubId}`,
  reconciler: "roster",
  severity,
  title: TITLES[op] ?? op,
  detail,
  fix,
  destructive,
});

/** GitHub's roster, flattened to the states we cache. Owners are applied LAST so
 *  that an Owner who also appears as a member reads as `teacher`. */
function liveStates(people: {
  teachers: OrgPerson[];
  students: OrgPerson[];
  pending: OrgPerson[];
}) {
  const map = new Map<string, { state: MemberState; person: OrgPerson }>();
  for (const person of people.students) {
    map.set(String(person.id), { state: "active", person });
  }
  for (const person of people.pending) {
    map.set(String(person.id), { state: "pending", person });
  }
  for (const person of people.teachers) {
    map.set(String(person.id), { state: "teacher", person });
  }
  return map;
}

export const roster: Reconciler = {
  name: "roster",

  async audit(ctx) {
    const live = liveStates(await ctx.people());
    const cached = new Map((await ctx.members()).map((m) => [m.githubId, m]));
    const findings: Finding[] = [];

    for (const [githubId, { state, person }] of live) {
      const was = cached.get(githubId);
      if (!was) {
        findings.push(
          finding(
            githubId,
            "add",
            "drift",
            false,
            `@${person.login} is in the organization but not on the class roster`,
            "Add them to the class roster",
          ),
        );
      } else if (was.state !== state) {
        const op =
          state === "teacher"
            ? "promote"
            : was.state === "teacher"
              ? "demote"
              : "add";
        findings.push(
          finding(
            githubId,
            op,
            "drift",
            false,
            `@${person.login} is "${state}" on GitHub, "${was.state}" here`,
            `Record them as ${state}`,
          ),
        );
      } else if (
        was.login !== person.login ||
        was.avatarUrl !== person.avatarUrl
      ) {
        findings.push(
          finding(
            githubId,
            "refresh",
            "info",
            false,
            was.login !== person.login
              ? `@${was.login} is now @${person.login}`
              : `@${person.login} changed their avatar`,
            "Refresh their details",
          ),
        );
      }
    }

    for (const [githubId, was] of cached) {
      if (live.has(githubId)) continue;
      findings.push(
        finding(
          githubId,
          "remove",
          "drift",
          // The ONE destructive roster operation. Starts unchecked.
          true,
          `@${was.login} is on the class roster but not in the organization`,
          "Remove them from the class roster",
        ),
      );
    }
    return findings;
  },

  async apply(ctx, keys) {
    // The live roster, so an add/promote writes what GitHub says rather than
    // what a stale proposal claimed. We trust the teacher's choice of SUBJECT,
    // never the client's description of it.
    const live = liveStates(await ctx.people());
    const results: (AppliedOp | FailedOp)[] = [];

    for (const key of keys) {
      const githubId = subjectOf(key);
      try {
        if (key.startsWith("roster:remove:")) {
          // ONE row. Never syncRoster, whose semantics are "delete everyone
          // absent from the live roster" — a stale proposal would then wipe
          // students it never named. Deleting a row already gone is a success.
          await forgetMember(ctx.db, ctx.cls.id, githubId);
        } else {
          const entry = live.get(githubId);
          if (!entry) throw new Error("no longer on the organization's roster");
          await observeMember(
            ctx.db,
            ctx.cls.id,
            {
              githubId,
              login: entry.person.login,
              avatarUrl: entry.person.avatarUrl,
            },
            entry.state,
          );
        }
        results.push({ key, ok: true });
      } catch (err) {
        results.push({
          key,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  },
};
