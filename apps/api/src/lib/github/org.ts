// Installation-token operations on a class's org. Least privilege: the App
// installation acts, never the user's OAuth token. One GitHub call plus
// narrowing per function; no orchestration (see README.md).
import type { AuthEnv } from "../auth/config";
import { installationOctokit } from "./clients";

/** Org identity for display (name may be unset on GitHub). */
export async function orgInfo(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<{ login: string; name: string | null; avatarUrl: string }> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /orgs/{org}", { org });
  return {
    login: data.login,
    name: data.name ?? null,
    avatarUrl: data.avatar_url,
  };
}

/** The two org settings roster enforces, its "org policy". */
export type OrgPolicy = {
  /** Base repository permission (labs wants "none"). */
  basePermission: string;
  /** Whether plain Members may create repositories (labs wants false). */
  membersCanCreateRepos: boolean;
};

/** The org's policy settings, read live. */
export async function orgPolicy(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<OrgPolicy> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /orgs/{org}", { org });
  return {
    basePermission: data.default_repository_permission ?? "",
    // A field absent from the payload means the API hid it, so assume the
    // unsafe value and let the caller flag it rather than trust it.
    membersCanCreateRepos: data.members_can_create_repositories ?? true,
  };
}

/** Lock the org to roster's policy in one PATCH: base repository permission
 *  "none", so membership grants nothing on its own and students see only repos
 *  they were granted, and no member repository creation, since work repos are
 *  born through labs and a repo a student creates on GitHub would sit outside
 *  every gate. Callers re-read to verify. */
export async function enforceOrgPolicy(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request("PATCH /orgs/{org}", {
    org,
    default_repository_permission: "none",
    members_can_create_repositories: false,
  });
}

/** True iff the GitHub user is an org Owner (a teacher is a live org `admin`).
 *  Errors propagate to the caller. */
export async function isOrgAdmin(
  env: AuthEnv,
  installationId: number,
  org: string,
  githubUserId: number,
): Promise<boolean> {
  const gh = await installationOctokit(env, installationId);
  const admins = await gh.paginate("GET /orgs/{org}/members", {
    org,
    role: "admin",
    per_page: 100,
  });
  return admins.some((member) => member.id === githubUserId);
}

/**
 * The user's live org membership: `{ state, role }`, or null when they're
 * neither a member nor invited (GitHub 404). Other errors propagate.
 */
export async function orgMembership(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<{ state: "active" | "pending"; role: string } | null> {
  const gh = await installationOctokit(env, installationId);
  try {
    const { data } = await gh.request(
      "GET /orgs/{org}/memberships/{username}",
      { org, username },
    );
    return { state: data.state, role: data.role };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** Invite the user as an org Member (pending until they accept natively). */
export async function inviteOrgMember(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<"active" | "pending"> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("PUT /orgs/{org}/memberships/{username}", {
    org,
    username,
    role: "member",
  });
  return data.state;
}

/** The GitHub user behind a typed username: canonical id, login and avatar, or
 *  null when no such user exists (404). Other errors propagate. */
export async function lookupUser(
  env: AuthEnv,
  installationId: number,
  username: string,
): Promise<{ id: number; login: string; avatarUrl: string } | null> {
  const gh = await installationOctokit(env, installationId);
  try {
    const { data } = await gh.request("GET /users/{username}", { username });
    return { id: data.id, login: data.login, avatarUrl: data.avatar_url };
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/** Promote an active org Member to Owner (teacher). Same call as
 *  `inviteOrgMember` with a higher role. */
export async function promoteToOrgAdmin(
  env: AuthEnv,
  installationId: number,
  org: string,
  username: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request("PUT /orgs/{org}/memberships/{username}", {
    org,
    username,
    role: "admin",
  });
}

/** Invite a non-member as an org Owner (teacher). Returns the invitation id,
 *  which is what keys pending people both on the live roster
 *  (`GET /orgs/{org}/invitations`) and in the `class_members` cache. */
export async function inviteOrgAdmin(
  env: AuthEnv,
  installationId: number,
  org: string,
  inviteeId: number,
): Promise<number> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("POST /orgs/{org}/invitations", {
    org,
    invitee_id: inviteeId,
    role: "admin",
  });
  return data.id;
}

export type OrgPerson = {
  id: number;
  login: string;
  avatarUrl: string | null;
};

/** What an open invitation is for. GitHub's invitation roles are finer than
 *  ours (`direct_member`, `billing_manager`, `hiring_manager`, …); only
 *  `admin` becomes a teacher, everything else an ordinary member. */
export type InvitedRole = "member" | "admin";

/** An open invitation: an OrgPerson keyed by invitation id, plus the role it
 *  grants, which decides whether they are an invited teacher. */
export type OrgInvitation = OrgPerson & { role: InvitedRole };

/**
 * The class's people, read live. Teachers are org Owners (role admin),
 * students are non-owner Members, pending are open invitations (no avatar, and
 * login falls back to the invite email: roster only creates username invites,
 * but org owners can invite by email on GitHub). Paginated so orgs beyond one
 * page stay correct.
 */
export async function orgPeople(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<{
  teachers: OrgPerson[];
  students: OrgPerson[];
  pending: OrgInvitation[];
}> {
  const gh = await installationOctokit(env, installationId);
  const [admins, members, invitations] = await Promise.all([
    gh.paginate("GET /orgs/{org}/members", {
      org,
      role: "admin",
      per_page: 100,
    }),
    gh.paginate("GET /orgs/{org}/members", {
      org,
      role: "member",
      per_page: 100,
    }),
    gh.paginate("GET /orgs/{org}/invitations", { org, per_page: 100 }),
  ]);
  const person = (m: { id: number; login: string; avatar_url: string }) => ({
    id: m.id,
    login: m.login,
    avatarUrl: m.avatar_url,
  });
  return {
    teachers: admins.map(person),
    students: members.map(person),
    pending: invitations.map((i) => ({
      id: i.id,
      login: i.login ?? i.email ?? "invited",
      avatarUrl: null,
      // Anything that is not an Owner invite is an ordinary member to us.
      role: i.role === "admin" ? ("admin" as const) : ("member" as const),
    })),
  };
}
