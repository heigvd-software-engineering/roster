# Nomenclature

The words roster uses, and what each one is on GitHub. One concept, one word: the
code, the UI and these docs use these terms and no synonyms. For how the pieces
fit together, see [architecture](./architecture.md). The terms missing from the
table below (lab, join link, drift, finding) have no GitHub counterpart.

## roster to GitHub

| roster | GitHub |
|---|---|
| Class | Organization with the roster GitHub App installed on it |
| Teacher | Organization Owner (`admin` in the API) |
| Student | Organization Member |
| Group | Team, created secret, one per lab |
| Work repo | Private repository the group's team holds push on |
| Starter code | Template repository in the class org |
| Enrollment | Organization membership, invited or active |
| Base permission | `default_repository_permission`, which roster pins to `none` |

## People

Roles are per class and live on GitHub: the same person teaches one class and studies in another. See [identity](./identity.md).

- **User** Someone signed in with SWITCH edu-ID who has linked a GitHub account. edu-ID is the identity, GitHub the execution surface.
- **edu-ID** SWITCH's academic account, the only way in. The registration's audience is HES-SO, so the `email` claim is the institutional address and `user.email` carries it.
- **Teacher**, **student** A live org Owner, a live org Member. Teacher covers professors and assistants alike.
- **Super admin** An email listed in `SUPER_ADMIN_EMAILS`. Config, never data. It opens the admin zone, where super admins hand out class creation.
- **Class creator** A user with a `class_creators` row, the one condition for creating a class. Super admins hold no implicit grant and toggle their own.

## Classes and labs

- **Class** A connected GitHub org, the teaching unit and top container. Everything else hangs off it. See [classes and labs](./classes-and-labs.md).
- **Lab** An assignment: a deadline, an optional start date, optional starter code, and a group mode (`individual` for a group of one, `group` with a min and max size).
- **Group** A team of students within one lab. Groups belong to a lab and are never shared across labs; copy-forward seeds a new group with an earlier one's members.
- **Work repo** The private repo a group gets once it reaches the lab's minimum size, generated from the starter code or empty. roster creates it and never adopts an existing repo.
- **Starter code** The UI's word for a template repository in the class org, recorded on `labs.templateRepoFullName`.
- **Join link**, **join token** `/join/:token`, carrying `classes.joinToken`: 128 random bits in hex, kept apart from the class id so a leaked link can be regenerated. Holding the link is the whole enrollment gate.
- **Enrollment** A student's org membership, obtained through the join link. `class_members` caches it for display and authorizes nothing.

## Verbs

- **Connect** Install the GitHub App on an org and confirm, which creates the class.
- **Link** Attach a GitHub account to a signed-in edu-ID user.
- **Join** Open a class join link, get an org invitation, accept it on GitHub.
- **Accept** Take on a lab: join or create a group, then get the work repo.
- **Reconcile** Compare the class against live GitHub and apply the fixes the teacher checks off. See [reconcile](./reconcile.md).

## Reconcile vocabulary

- **Drift** A gap between roster's rows and GitHub's state, ranked `broken`, `drift` or `info`.
- **Finding** One drift, with a stable key, the fix Apply would perform, and the `from → to` it produces. Audit reads, Apply writes.
- **Reconciler** One module for one GitHub-authoritative concern: `installation`, `identity`, `roster`, `group-teams`, `group-members`, `work-repos`, `base-permission`.
- **GitHub sync** The teacher-facing label for reconcile. "Audit" and "reconcile" stay in the code.

## A group's four names

| Column | What it holds |
|---|---|
| `name` | Display label ("Team Alpha"), unique per lab, never sent to GitHub |
| `slug` | `slugify(lab.title)-slugify(group.name)`, the name roster asks GitHub to give the team, and the work repo's name |
| `ghTeamSlug` | The slug GitHub returned, source of truth for API paths. Equals `slug` unless GitHub deduped it |
| `ghTeamId` | The team's numeric id, the real key, since slugs change on rename |

## Pairs to keep apart

- **Group** is roster's word, **team** is GitHub's. One group owns exactly one team. Write group everywhere except when naming the GitHub object.
- **roster** the product against **a roster**, the live member list of an org or a team. The live list authorizes; `class_members` and `group_members` only cache it for display. See [data model](./data-model.md).
- **`slug`** is what roster proposed, **`ghTeamSlug`** is what GitHub granted. API paths use `ghTeamSlug`, the repo name uses `slug`.
- **Class member** means org membership, **group member** means team membership. A student can be the first without being the second.
