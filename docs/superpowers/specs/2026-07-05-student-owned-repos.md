# Student-Owned Lab Repos — draft proposal

**Date:** 2026-07-05
**Project:** `labs`
**Status:** DRAFT — to be discussed with colleagues (data-policy review pending)
**Relates to:** `2026-06-25-data-model.md`, `2026-06-25-groups-teams-design.md`,
`2026-06-25-foundation-identity-design.md`

Proposal to move student lab repos out of the class organization and onto the
students' own GitHub accounts. Nothing here is implemented; this document
exists to be shot down or confirmed.

---

## 1. Problem

At the end of a semester the class organization has accumulated hundreds of
student work repos. In practice the org is then deleted, or a fresh org is
created per semester/class. Costs of the current model:

- **Org pollution** — the org's repo list becomes unusable; cleanup is manual
  and destructive (students lose their work when the org is deleted).
- **Org churn** — new orgs every semester, each needing App install + base
  permission setup + fresh join links.
- **Ownership mismatch** — the work is the student's, but the school org owns
  (and eventually deletes) it.

## 2. Proposed model

| Concept | Today (org-owned) | Proposed (student-owned) |
|---|---|---|
| Student work repo | Private repo **in the org** | **Private repo on the student's account** |
| Repo creation | App installation token, in org | Student's **OAuth user token** (`/generate` from template), on their account |
| labs' access to work | Org App installation | **Per-repo App installation on the student account** |
| Templates | Repos in org (template-flagged) | **Public repos in the org** (see §6) |
| Students in the org? | Members (base permission `No access`) | **Not members at all** |
| Roster | GitHub org membership (live) | **labs DB** (see §4) |
| Group roster | GitHub Team membership (live) | **labs DB** (see §5) |
| Student isolation | Base permission `No access` | Structural — repos live in separate personal accounts |
| Semester end | Delete org / repos | Delete DB rows; students keep their work |

The org shrinks to: teachers (Owners) + public template repos. It is reusable
across semesters.

## 3. Student flow (happy path)

From the student's lab page (they enrolled in the class via the join link):

1. Student sees the labs of their classes and clicks **Accept lab**.
2. For a group lab: pick/create the group first (§5).
3. labs creates a **private repo on the student's account** with the student's
   OAuth user token — `POST /repos/{template}/generate` (template) or
   `POST /user/repos` (empty). Requires the `repo` scope at GitHub-link time
   (scope change from today's read-only link).
4. labs sends the student to install the App **on exactly that repo**
   (install URL + repo pre-selection; the callback verifies what actually
   arrived).
5. The setup callback links `installationId` + `ghRepoId` to the
   `student_lab_repos` row. Teacher dashboards read the work through this
   per-repo installation from then on.

Step 3 before step 4 is deliberate: labs creates the repo *for* the student,
so the student never faces "create a repo, then install, then select the
right one" — the error surface of a manual flow.

## 4. Roster — entirely on labs' side

Without org membership, GitHub no longer holds the class roster.

> **Note (2026-07-05):** `class_members` now arrives *earlier* than this
> proposal, as an enrollment **display cache** for the student class list in
> the current org-membership model (see data-model spec §2 — keyed on
> `githubId`, `pending`/`active` state, write-points + lazy repair, never
> authorization). This section describes its **promotion to authority** if
> the student-owned model is adopted: join inserts directly, org invites and
> the `pending` state disappear.

New table:

### `class_members`
| column | type | notes |
|---|---|---|
| `id` | text, pk | |
| `classId` | text, fk → `classes.id` | |
| `userId` | text, fk → `user.id` | |
| `joinedAt` | timestamp | |

Unique on `(classId, userId)`.

- **Join link** → inserts a row (instant; the org-invite dance, `pending`
  state, and "never demote an Owner" guard all disappear).
- **Teachers** remain GitHub org Owners — teacher identity/authorization is
  unchanged.
- **People lists** come from the DB + the linked GitHub identity. The GitHub
  People tab no longer reflects the class; labs is the only roster UI.
- **Consequence for the join token**: today a leaked link still produces a
  visible org invitation; here it silently enrolls. Compensations: show
  enrollments prominently to teachers, keep the token regenerable (already
  spec'd), optionally add teacher approval.
- This also revives the earlier "store the GitHub profile" decision (rejected
  2026-07-05 for `/api/me` alone): with no `orgPeople` call to supply
  login/name/avatar for the people chips, storing the profile at link time
  becomes necessary rather than nice-to-have.

## 5. Groups — first joiner owns the repo

GitHub Teams require org membership, so the groups-as-teams design
(2026-06-25) does not survive this model. Group roster moves to the DB
(`group_members`: groupId, userId, joinedAt; `groups` loses `ghTeamId`/slug).

Repo ownership within a group (decision): **the first student of the group to
accept the lab becomes the repo owner** — the repo is created on their
account. Subsequent members are added as collaborators:

- Invite via the **owner's** token (`PUT /repos/{owner}/{repo}/collaborators/{username}`),
- Accept via the **member's own** token (`PATCH /user/repository_invitations/{id}`) —
  labs holds both tokens, so the handshake is fully automatic; no student
  action needed.

Accepted risks: ownership asymmetry (owner can remove collaborators, delete
the repo, leave the class). Deadline snapshots (§7) are the backstop; a
teacher "transfer/recreate repo" escape hatch can come later if it bites.

## 6. Templates

Public template repos in the org are the simple path: the student's token can
`/generate` from any public template, and no student-side org access is ever
needed. Accepted consequence: **starter code is world-readable** (including
future cohorts).

If a template must be private, there is a fallback that keeps this model: the
org App installation reads the template, labs copies content server-side into
the student repo via the student-side access. More plumbing — only build it
when a real course needs private templates.

## 7. Custody & integrity (the price of the model)

The student owns the repo. They can delete it, uninstall the App, rewrite
history, or flip it public (leaking their solution). Mitigations, both
first-class features of this model rather than options:

1. **Snapshot at deadline** — labs archives the repo state at the deadline
   (into labs-side storage or a teacher-visible archive). Grading happens on
   the snapshot; post-deadline sabotage becomes irrelevant.
2. **Webhook monitoring** — the per-repo installation delivers `repository`
   (visibility change, delete, rename) and `installation` (uninstall) events;
   labs flags the lab row and alerts the teacher immediately.

"Must be private" is enforced at creation (labs creates the repo private) and
*observed* afterwards (webhook) — it cannot be guaranteed.

## 8. Data-policy questions (for the colleague discussion)

- Student work now lives on **personal GitHub accounts** — is coursework on
  private third-party personal storage acceptable? (Flip side: today the
  school org holds it and then deletes it.)
- **Snapshots**: where are they stored, how long are they retained, who can
  access them after the semester?
- The `repo` OAuth scope grants labs write access to **all** the student's
  personal repos, not just the lab repo — broader consent than today's link.
  (GitHub's fine-grained user tokens may narrow this; to verify.)
- Roster data (class membership) moves from GitHub into our D1 database —
  retention/deletion policy needed for `class_members` after semester end.

## 9. Impact on the current spec (delta summary)

- `classes`: unchanged (still the installation anchor + join token).
- `labs`: unchanged, except templates must be public (or §6 fallback).
- `groups`: loses `ghTeamId`/`ghTeamSlug`; gains DB roster (`group_members`).
- `student_lab_repos`: gains `ownerUserId` and `installationId` (the per-repo
  student-side installation); `ghRepoFullName` now points at a personal repo.
- New: `class_members`, `group_members`.
- `setup.ts` callback branches: org install (teacher, class creation — today's
  path) vs. user install (student, lab repo linking — new path), keyed on the
  installation account type + expected-repo validation.
- Deleted concepts: org invites (`inviteOrgMember`, `orgMembership`,
  `pending`), base-permission setup (`confirmClass` / the confirm page),
  students-as-members copy in the new-class dialog.
- "Delegate to GitHub" guiding principle (data-model §0) is consciously
  weakened: roster and group membership become **labs-owned** because GitHub
  no longer has an object that models them.

## 10. Open questions

- Fine-grained PATs / GitHub App user tokens with narrower repo scopes — can
  repo creation happen without the broad `repo` scope?
- Group lab where the owner never installs the App (stalls step 4) — nudge
  flow? teacher visibility?
- Does the student keep the repo after the class ends (portfolio value) or is
  there a course requirement to delete? Interacts with §8 retention.
- Rate limits: repo creation now spends each student's own quota (5k/h/user)
  — a non-issue at class scale, but worth stating.
