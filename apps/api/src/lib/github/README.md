# github/: every GitHub operation roster performs

This folder is the **complete inventory** of the app's GitHub surface. Routes
never import octokit or `clients.ts` directly; they compose the named
operations below.

## Rules

1. **One operation = one GitHub call + response narrowing.** No orchestration,
   no db access, no business rules. Once a function makes two calls and a
   decision, it's a route's job.
2. **Files are grouped by CREDENTIAL.** Which token acts is the
   security-critical dimension (least privilege):

| File | Acts as | Operations |
|---|---|---|
| `clients.ts` | nothing (folder-internal octokit factories) | `appJwtOctokit`, `installationOctokit`, `WorkersOctokit` |
| `app.ts` | the App (JWT) | `installationAccount`, `orgLogin` |
| `org.ts` | the App's **installation** on a class org | `orgInfo`, `orgPolicy`, `enforceOrgPolicy`, `isOrgAdmin`, `orgMembership`, `inviteOrgMember`, `orgPeople`, `lookupUser`, `promoteToOrgAdmin`, `inviteOrgAdmin` |
| `team.ts` | the App's **installation** on a class org | `createTeam`, `teamMembers`, `addTeamMember`, `removeTeamMember`, `deleteTeam` (groups = GitHub Teams, F7) |
| `repo.ts` | the App's **installation** on a class org | `createOrgRepo`, `generateFromTemplate`, `getOrgRepo`, `grantTeamRepo`, `orgRepoActivity`, `reposLastCommit`, `orgTemplateRepos` (work repos, F8); `classifyRepoFailure` (no call: octokit error-shape knowledge stays in this folder) |
| `user.ts` | the caller's **own** OAuth token | `fetchGithubProfile`, `userInstallationsByOrgId`, `userOrgMemberships`, `userHasInstallation` |

3. **List reads paginate** (`per_page: 100` + `gh.paginate`); an unpaginated
   org read silently truncates at 30.
4. Narrowed return shapes here ARE the wire model. `hc<AppType>` inference
   carries them to the SPA; don't re-declare them elsewhere.

## App-permission audit map

Each granted permission maps onto operations here, so "why does roster need
X?" has a function as its answer:

- **Organization Administration: write** → `enforceOrgPolicy`, one PATCH
  asserting base repository permission "none" AND member repository creation
  off (+ `orgPolicy` read)
- **Repository Administration + Contents: write** (F8, must be granted on the App AND re-approved on installations) → `createOrgRepo`, `generateFromTemplate`, `grantTeamRepo` (+ `orgTemplateRepos` read)
- **Organization Members: write** → `inviteOrgMember`, `team.ts` (create/delete teams, manage team membership) (+ `orgPeople`, `orgMembership`, `isOrgAdmin`, `teamMembers`, `lookupUser` reads)
- **Organization Members: write, Owner-granting** → `promoteToOrgAdmin`
  (`PUT /orgs/{org}/memberships/{username}`, `role: "admin"`) and
  `inviteOrgAdmin` (`POST /orgs/{org}/invitations`, `role: "admin"`). The most
  privileged calls roster makes: they make someone an **org Owner**, i.e. a
  teacher. Listed separately because the line above alone under-reports the
  App's authority.
- **User OAuth (`read:org` + profile)** → `user.ts` (identity + installation ownership only)
