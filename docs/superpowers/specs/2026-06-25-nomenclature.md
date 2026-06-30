# Nomenclature

**Date:** 2026-06-25
**Project:** `labs`

Canonical terms for the whole project. The specs, the code, and the UI use these
words and no synonyms.

---

## People

| Term | Definition | GitHub reality |
|---|---|---|
| **User** | A person signed in via SWITCH edu-ID with a linked GitHub account. No global role. | — |
| **Teacher** | A user who is an **Owner** of a class's org. Sees every repo. Covers professors and assistants alike. | org **Owner** |
| **Student** | A user who is a **Member** of a class's org. | org **Member** |

> Role is always **relative to a class** — the same user can be a teacher of one
> class and a student of another. There is no global role.

## Containers & work

| Term | Definition | GitHub reality |
|---|---|---|
| **Class** | A GitHub **organization** connected to the app via the GitHub App installation. The teaching unit and top-level container. | **organization** + **installation** |
| **Group** | A **reusable** team of students in a class, usable across multiple labs (a **solo lab is a group of one**). Has a creator. (Min/max is a per-lab setting, **Labs-enforced**.) | **Team** |
| **Lab** | An assignment: an optional **template** + a **deadline** (required) + group settings (**individual** = a group of one, or **group** with min/max). Visible to students on creation. | — (app entity) |
| **Template** | A repository marked as a GitHub template, used to generate student lab repos. | template **repository** |
| **Student lab repo** | The **private** repo generated for a group (a **solo lab is a group of one**) on **accept** — from the lab's **template**, or an **empty** repo when the lab has none. | **repository** |

## GitHub primitives → our terms

| GitHub | Our term |
|---|---|
| Organization | **Class** |
| Org **Owner** | **Teacher** |
| Org **Member** | **Student** |
| **Team** | **Group** |
| App **Installation** | a class's existence |
| **Base permission** | org-wide repo access floor (set to **`No access`**) |
| Template repository | **Template** |
| Generated repository | **Student lab repo** |

## Verbs

| Term | Definition |
|---|---|
| **Connect** | Install the GitHub App on an org and run the confirm step → creates a **class**. |
| **Link** | Attach a GitHub account to a user (onboarding). |
| **Join** | A student opens a class's **join link** → Labs creates an org-membership invite and the student accepts on GitHub → becomes a **Member** (enrolled). |
| **Accept** | A student action on a lab that generates their **student lab repo**. |

## Implementation note

> `class` and `group` are reserved words (TS/JS and SQL), so the DB
> tables/variables are **plural** — `classes`, `groups` (and `labs`,
> `student_lab_repos`). The domain terms stay singular: **Class**, **Group**.
