# github/ — every GitHub operation labs performs

This folder is the **complete inventory** of the app's GitHub surface.
Routes never import octokit or `clients.ts` directly — they compose the
named operations below.

## Rules

1. **One operation = one GitHub call + response narrowing.** No
   orchestration, no db access, no business rules — the moment a function
   makes two calls and a decision, it's a route's job.
2. **Files are grouped by CREDENTIAL** — which token acts is the
   security-critical dimension (least privilege):

| File | Acts as | Operations |
|---|---|---|
| `clients.ts` | — (folder-internal octokit factories) | `appJwtOctokit`, `installationOctokit` |
| `app.ts` | the App (JWT) | `installationAccount`, `orgLogin` |
| `org.ts` | the App's **installation** on a class org | `orgInfo`, `basePermission`, `setBasePermissionNone`, `isOrgAdmin`, `orgMembership`, `inviteOrgMember`, `orgPeople` |
| `team.ts` | the App's **installation** on a class org | `createTeam`, `teamMembers`, `addTeamMember`, `removeTeamMember`, `deleteTeam` (groups = GitHub Teams, F7) |
| `user.ts` | the caller's **own** OAuth token | `fetchGithubProfile`, `userInstallationsByOrgId`, `userHasInstallation` |

3. **List reads paginate** (`per_page: 100` + `gh.paginate`) — an unpaginated
   org read silently truncates at 30.
4. Narrowed return shapes here ARE the wire model — `hc<AppType>` inference
   carries them to the SPA; don't re-declare them elsewhere.

## App-permission audit map

The GitHub App's granted permissions map onto operations — when a permission
review asks "why does labs need X?", the answer is a function in this folder:

- **Organization Administration: write** → `setBasePermissionNone` (+ `basePermission` read)
- **Organization Members: write** → `inviteOrgMember`, `team.ts` (create/delete teams, manage team membership) (+ `orgPeople`, `orgMembership`, `isOrgAdmin`, `teamMembers` reads)
- **User OAuth (`read:org` + profile)** → `user.ts` (identity + installation ownership only)
