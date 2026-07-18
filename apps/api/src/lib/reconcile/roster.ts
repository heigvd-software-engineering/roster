// The live org roster vs the `class_members` display cache.
//
// THE only whole-roster observer. Every other write point — observeMember,
// forgetMember, the join POSTs — sees exactly one person: the caller. So this is
// the only thing that can notice someone who joined the org out of band, an
// Owner who was promoted, a login that changed, or a student who left.

import { forgetMember, type MemberState, observeMember } from "../enrollment";
import type { OrgInvitation, OrgPerson } from "../github/org";
import type {
  AppliedOp,
  FailedOp,
  Finding,
  FindingKey,
  Reconciler,
  Severity,
} from "./types";

/**
 * WHO a finding is about. GitHub reports a roster in two id spaces and they
 * are not interchangeable: members and Owners arrive as USER ids, open invites
 * as INVITATION ids (`/orgs/{org}/invitations` never returns the invitee's user
 * id). A subject therefore says which space it belongs to — comparing a bare
 * number across the two would silently mistake an invitation for a person.
 */
type Subject = { kind: "user" | "invite"; id: string };

/** "user=123" / "invite=456" — the id space travels WITH the id. */
const subjectKey = ({ kind, id }: Subject) => `${kind}=${id}`;
const userSubject = (id: string | number): Subject => ({
  kind: "user",
  id: String(id),
});
const inviteSubject = (id: string | number): Subject => ({
  kind: "invite",
  id: String(id),
});

/** "roster:remove:user=9" → "user=9". Findings are content-addressed, so the
 *  key IS the subject: nothing else has to travel from audit to apply. */
const subjectOf = (key: FindingKey) => key.split(":")[2] ?? "";

const parseSubject = (subject: string): Subject | null => {
  const [kind, id] = subject.split("=");
  if ((kind !== "user" && kind !== "invite") || !id) return null;
  return { kind, id };
};

/** The row a subject names, in the id space it belongs to. */
const memberKeyOf = (subject: Subject) =>
  subject.kind === "user"
    ? { githubId: subject.id }
    : { invitationId: subject.id };

const TITLES: Record<string, string> = {
  add: "A member is missing from the class roster",
  remove: "A member left the organization",
  promote: "A member became an organization Owner",
  demote: "An Owner is no longer an Owner",
  refresh: "A member's GitHub details changed",
};

/** How a cached state reads on the class card — the from/to chips speak the
 *  card's language, not the enum's. */
const STATE_LABEL: Record<MemberState, string> = {
  pending: "Invited",
  pending_teacher: "Invited as teacher",
  active: "Student",
  teacher: "Teacher",
};

const finding = (
  subject: Subject,
  op: string,
  severity: Severity,
  detail: string,
  fix: string,
  change: Finding["change"],
): Finding => ({
  key: `roster:${op}:${subjectKey(subject)}`,
  reconciler: "roster",
  severity,
  title: TITLES[op] ?? op,
  detail,
  fix,
  change,
});

/** GitHub's roster, flattened to the states we cache and keyed by SUBJECT.
 *  Owners are applied LAST so that an Owner who also appears as a member reads
 *  as `teacher`. Pending people key on their invitation, everyone else on their
 *  user id — `orgPeople` already hands them over that way. */
function liveStates(people: {
  teachers: OrgPerson[];
  students: OrgPerson[];
  pending: OrgInvitation[];
}) {
  const map = new Map<
    string,
    { state: MemberState; person: OrgPerson; subject: Subject }
  >();
  const put = (subject: Subject, state: MemberState, person: OrgPerson) =>
    map.set(subjectKey(subject), { state, person, subject });

  for (const person of people.students) {
    put(userSubject(person.id), "active", person);
  }
  for (const invite of people.pending) {
    // The invitation's ROLE picks the state, exactly as it does for accepted
    // members (`teacher` vs `active`) — an Owner invite is a pending teacher.
    put(
      inviteSubject(invite.id),
      invite.role === "admin" ? "pending_teacher" : "pending",
      invite,
    );
  }
  for (const person of people.teachers) {
    put(userSubject(person.id), "teacher", person);
  }
  return map;
}

/**
 * The cached row's subject — which id space this row should be COMPARED in.
 *
 * A row we wrote for an invite WE sent carries both ids, and the answer depends
 * on what GitHub says now: while the invite is open the live roster lists it as
 * an invitation, so the row must compare as `invite=` or it would read as a
 * missing person plus a stale invitation. Once they accept, the live roster
 * lists them as a USER, and comparing the same row as `user=` turns what would
 * be a spurious remove+add pair into one honest "they became a teacher".
 */
const cachedSubject = (
  row: { githubId: string | null; invitationId: string | null },
  live: Map<string, unknown>,
): Subject | null => {
  if (row.githubId && live.has(subjectKey(userSubject(row.githubId)))) {
    return userSubject(row.githubId);
  }
  if (row.invitationId) return inviteSubject(row.invitationId);
  return row.githubId ? userSubject(row.githubId) : null;
};

export const roster: Reconciler = {
  name: "roster",

  async audit(ctx) {
    const live = liveStates(await ctx.people());
    // Each cached row is placed in the id space GitHub is currently using for
    // it, so both sides of the diff speak the same language. A row that is in
    // neither space (no ids at all) cannot be named by a finding, so it cannot
    // be repaired — `observeMember` refuses to create one.
    const cached = new Map(
      (await ctx.members()).flatMap((m) => {
        const subject = cachedSubject(m, live);
        return subject ? [[subjectKey(subject), m] as const] : [];
      }),
    );
    const findings: Finding[] = [];

    for (const [key, { state, person, subject }] of live) {
      const was = cached.get(key);
      if (!was) {
        findings.push(
          finding(
            subject,
            "add",
            "drift",
            `@${person.login} is in the organization but not on the class roster`,
            "Add them to the class roster",
            { from: "Not on the roster", to: STATE_LABEL[state] },
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
            subject,
            op,
            "drift",
            `@${person.login} is "${state}" on GitHub, "${was.state}" here`,
            `Record them as ${state}`,
            {
              from: STATE_LABEL[was.state as MemberState] ?? was.state,
              to: STATE_LABEL[state],
            },
          ),
        );
      } else if (
        was.login !== person.login ||
        was.avatarUrl !== person.avatarUrl
      ) {
        findings.push(
          finding(
            subject,
            "refresh",
            "info",
            was.login !== person.login
              ? `@${was.login} is now @${person.login}`
              : `@${person.login} changed their avatar`,
            "Refresh their details",
            was.login !== person.login
              ? { from: `@${was.login}`, to: `@${person.login}` }
              : { from: "previous avatar", to: "new avatar" },
          ),
        );
      }
    }

    for (const [key, was] of cached) {
      if (live.has(key)) continue;
      const subject = parseSubject(key);
      if (!subject) continue;
      findings.push(
        finding(
          subject,
          "remove",
          "drift",
          `@${was.login} is on the class roster but not in the organization`,
          "Remove them from the class roster",
          {
            from: STATE_LABEL[was.state as MemberState] ?? was.state,
            to: "Not on the roster",
          },
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
      const subjectStr = subjectOf(key);
      try {
        const subject = parseSubject(subjectStr);
        if (!subject) throw new Error(`unrecognised subject "${subjectStr}"`);

        if (key.startsWith("roster:remove:")) {
          // ONE row. Never syncRoster, whose semantics are "delete everyone
          // absent from the live roster" — a stale proposal would then wipe
          // students it never named. Deleting a row already gone is a success.
          await forgetMember(ctx.db, ctx.cls.id, memberKeyOf(subject));
        } else {
          const entry = live.get(subjectStr);
          if (!entry) throw new Error("no longer on the organization's roster");

          if (subject.kind === "user") {
            // A real person. If they got here by ACCEPTING an invite we sent,
            // an invitation-keyed row may still exist — under the same user id
            // (our own invite, which recorded both) or under none at all (an
            // invite from GitHub's UI, which we could never attribute). The
            // first updates in place; the second would strand an orphan row
            // that keeps showing them as invited, so drop it first.
            const login = entry.person.login.toLowerCase();
            const orphan = (await ctx.members()).find(
              (m) =>
                m.invitationId !== null &&
                // Our own invite: the user id ties the rows together outright.
                // Otherwise login is the ONLY correlation there is — matching
                // on "has no user id" alone would delete somebody else's
                // pending invite.
                (m.githubId === subject.id ||
                  (m.githubId === null && m.login?.toLowerCase() === login)),
            );
            if (orphan?.invitationId) {
              await forgetMember(ctx.db, ctx.cls.id, {
                invitationId: orphan.invitationId,
              });
            }
            await observeMember(
              ctx.db,
              ctx.cls.id,
              {
                githubId: subject.id,
                login: entry.person.login,
                avatarUrl: entry.person.avatarUrl,
              },
              entry.state,
            );
          } else {
            // Still an open invitation — the only id GitHub gives us. `login`
            // may be an email here (org owners can invite by address), which
            // is exactly why there is no user id to record.
            await observeMember(
              ctx.db,
              ctx.cls.id,
              {
                githubId: null,
                invitationId: subject.id,
                login: entry.person.login,
                avatarUrl: entry.person.avatarUrl,
              },
              entry.state,
            );
          }
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
