// Installation-token operations on a class's org — least privilege: the App
// installation acts, never the user's OAuth token. One GitHub call +
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

/** The org's base repository permission (labs wants "none"). */
export async function basePermission(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<string> {
  const gh = await installationOctokit(env, installationId);
  const { data } = await gh.request("GET /orgs/{org}", { org });
  return data.default_repository_permission ?? "";
}

/** Set the org's base repository permission to No access, so students only
 *  see repos they're explicitly granted. Callers re-read to verify. */
export async function setBasePermissionNone(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<void> {
  const gh = await installationOctokit(env, installationId);
  await gh.request("PATCH /orgs/{org}", {
    org,
    default_repository_permission: "none",
  });
}

/** True iff the GitHub user is an org Owner (teacher = live org `admin`).
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

export type OrgPerson = {
  id: number;
  login: string;
  avatarUrl: string | null;
};

/**
 * The class's people, read live. Teachers = org Owners (role admin),
 * students = non-owner Members, pending = open invitations (no avatar; login
 * falls back to the invite email — labs only creates username invites, but
 * org owners can invite by email on GitHub). Paginated so orgs beyond one
 * page stay correct.
 */
export async function orgPeople(
  env: AuthEnv,
  installationId: number,
  org: string,
): Promise<{
  teachers: OrgPerson[];
  students: OrgPerson[];
  pending: OrgPerson[];
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
    })),
  };
}
