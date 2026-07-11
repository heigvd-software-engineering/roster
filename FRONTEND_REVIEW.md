# Frontend Review Tracker — Milestone 7 (Frontend Quality)

**Branch:** `milestone-7-frontend-quality` (off `main`)
**Source review:** frontend-review skill, full `apps/www/app` (85 files) @ `main` `7f3d62f`, run 2026-07-11
**Findings:** 23 tracked items (26 raw findings) — 3 render, 3 perf, 10 structure/reuse, 7 organization. `ui/` primitives clean; route code-splitting handled by React Router framework mode.

---

## How we work this tracker (iterative approach)

This is a **discussion-first, human-gated** backlog — not a to-do list to burn down autonomously.

- **One item at a time.** We pick an item, *talk about it*, and decide together: **KEEP** (intentional as-is, close it), **DO** (worth changing), or **DEFER** (valid but not now). The finding is a *proposal*, not a verdict.
- **Agree the "how" before touching code.** For a DO item, we settle the concrete approach (which primitive, which shape, how far the refactor reaches) *before* editing. Minimal, feature-iterative changes.
- **Nothing is committed until you say so.** Each item (or a small cluster) becomes its own commit once you validate it. Commits on this repo carry **no `Co-Authored-By` trailer** (labs convention).
- **Record the outcome here.** Every item's `Decision` + `Notes` get filled in as we go, so this file is the source of truth and any session can resume cold by reading it.
- **Tests come at the end**, only after the affected behavior is validated — and only where they earn their keep (not for declarative/generated code).

**To resume in a new session:** read this file top-to-bottom, find the first item whose Status isn't ✅/⛔, and continue from there.

### Status legend

| Mark | Meaning |
|------|---------|
| 🔲 Open | Not yet discussed |
| 💬 Discussing | Strategy under discussion |
| 🛠️ In progress | Decision = DO, edit underway |
| ✅ Done | Change made + validated (note commit) |
| ⛔ Won't do | Decision = KEEP (intentional) — closed, with rationale |
| ⏸️ Deferred | Valid but parked for later |

---

## Progress summary

| ID | Location | Lens | Priority | Status | Decision |
|----|----------|------|----------|--------|----------|
| R1 | `join-page.tsx:97` | render | high | 🔲 | — |
| R2 | `classes-page.tsx:81` | render | low | 🔲 | — |
| R3 | `new-group-dialog.tsx:103` | render | med | 🔲 | — |
| P1 | `message-context.tsx:93` | perf | high | ✅ | DO — split contexts |
| P2 | `class-confirm-page.tsx:14`, `reconcile-page.tsx:84` | perf | high | 🔲 | — |
| P3 | `roster.tsx:123`, `group-tile.tsx:122` | perf | med | 🔲 | — |
| S1 | `teacher-lab-groups.tsx:365` | structure | med | 🔲 | — |
| S2 | `new-group-dialog.tsx:151` | structure | med | 🔲 | — |
| S3 | `lab-row.tsx:96` + "mono note" ×5 | structure | med | 🔲 | — |
| S4 | `enrolled-class-card.tsx:53` | structure | low | 🔲 | — |
| S5 | `join-page.tsx:243` | structure | med | 🔲 | — |
| S6 | `lab-row.tsx:123` | structure | low | 🔲 | — |
| S7 | `routes/*` Auth gate ×7 | structure | med | 🔲 | — |
| S8 | `onboarding.tsx:16` | structure | low | 🔲 | — |
| S9 | `text.tsx:35` | structure | low | 🔲 | — |
| S10 | `start-lab-card.tsx:113` | structure | low | 🔲 | — |
| O1 | `lib/api.ts:33` | organization | med | 🔲 | — |
| O2 | `lib/api.ts:54` | organization | low | 🔲 | — |
| O3 | `routes.ts:5` | organization | med | 🔲 | — |
| O4 | `org-identity.tsx:20`, `user-avatar.tsx:28` | organization | low | 🔲 | — |
| O5 | `identity/*` size scales | organization | low | 🔲 | — |
| O6 | `student-lab-groups.tsx:80` | organization | low | 🔲 | — |
| O7 | `connect-failed.tsx:4` | organization | low | 🔲 | — |

---

## Render correctness

### R1 — `pages/join-page.tsx:97` · high · 🔲 Open
**Issue:** fetch effect `setState`s after `await` with no stale-response guard (no `ignore` flag / `AbortController`).
**Cost:** a `token` change or unmount lets a late response clobber current state — stale class, or a spurious `error`/`invalid`.
**Proposed fix:** capture `let ignore = false` in the effect, bail in every `setState` path, `return () => { ignore = true }`.
**Decision:** —
**Notes:** —

### R2 — `pages/classes-page.tsx:81` · low · 🔲 Open
**Issue:** auto-skip effect `setOldest` off fetched `data` drives a fetch→data→effect cascade; the `autoSkips` ref exists only to stop it looping.
**Cost:** the flagged "setState-from-data in an effect" shape.
**Proposed fix:** likely **KEEP** — defensible because SWR gives no arrival callback. Revisit only if `useApi` gains an `onSuccess`.
**Decision:** —
**Notes:** —

### R3 — `groups/shared/new-group-dialog.tsx:103` · med · 🔲 Open
**Issue:** selection stored as the full `ReusableGroup` object, then re-looked-up on change (line 162).
**Cost:** duplicates a row of server state that can go stale vs `data.groups`.
**Proposed fix:** store the id; derive the object where needed.
**Decision:** —
**Notes:** —

---

## Rendering & performance

### P1 — `contexts/message-context.tsx:93` · high · ✅ Done
**Issue:** `useMessages()` returns the whole context value (rebuilt on every toast push/dismiss), but nearly all consumers use only the stable `push`.
**Cost:** every action button, header, and page re-renders whenever *any* toast appears or auto-dismisses.
**Proposed fix:** split into two contexts — stable `{push, dismiss}` for writers, `messages` for the viewport only.
**Decision:** **DO.** Split into `MessageActionsContext` (`{push, dismiss}`, stable identity) + `MessageListContext` (`messages`). Writers subscribe to actions → no re-render on toast activity; only `MessageViewport` reads the list. Public API (`MessageProvider`/`MessageViewport`/`useMessages`) unchanged, no call sites touched.
**Notes:** Pure render-cost fix, no behavior change. typecheck + biome clean. Validated by eye (no test — declarative/behavioral parity). Commit: see git log for the P1 commit on `milestone-7-frontend-quality`.

### P2 — `pages/class-confirm-page.tsx:14` & `pages/reconcile-page.tsx:84` · high · 🔲 Open
**Issue:** both fetch the entire unbounded `api.api.classes` list solely to read one `orgName` / `cls.name` for the header — contradicts the lab pages' documented "ONE request, no /api/classes just for the header."
**Cost:** every visible teaching class costs a live GitHub call; the whole roster is pulled to render one label.
**Proposed fix:** read a single class / surface the name in the existing response / pass via nav state.
**Decision:** —
**Notes:** —

### P3 — `groups/teacher/roster.tsx:123` & `groups/shared/group-tile.tsx:122` · med · 🔲 Open
**Issue:** `AvatarCluster` rebuilds `usersByGithubId(users)` per row (and `GroupMembers` per drawer), though `teacher-lab-groups.tsx:95` already built the same map once.
**Cost:** N+ full array re-scans per render (fine at ~30 students, wasteful + duplicated).
**Proposed fix:** build the map once, pass it down as a prop.
**Decision:** —
**Notes:** —

---

## Structure, simplification & reuse

### S1 — `groups/teacher/teacher-lab-groups.tsx:365` · med · 🔲 Open
**Issue:** the whole `useLabGroups` return (data + ~12 action fns) is prop-drilled as one bag into `RosterToolbar`/`GroupRow`/`GroupDrawer`, while `AddFromPool` gets narrow props — inconsistent, rows coupled to the entire hook API.
**Cost:** rows/drawers can't be reasoned about from their signature; they re-render with the full imperative surface.
**Proposed fix:** pass the specific verbs/data each child uses (as `AddFromPool` already does).
**Decision:** —
**Notes:** —

### S2 — `groups/shared/new-group-dialog.tsx:151` · med · 🔲 Open
**Issue:** the reusable-groups list is specified twice — a value→label map (151-159) and the `SelectItem` children (171-177) — with divergent label formats and a duplicated `"An empty group"` string.
**Cost:** the two renderings drift on any label change; the map is pure boilerplate.
**Proposed fix:** derive both from one array. *(Note: the similar-looking `lab-dialog.tsx:298` double-spec is NOT removable — Base-UI Select needs `items` for the closed-trigger lookup.)*
**Decision:** —
**Notes:** —

### S3 — `labs/lab-row.tsx:96` + `labs/deadline-text.tsx:37` (+ "mono note" ×5) · med · 🔲 Open
**Issue:** lab-row hand-rolls the exact urgency-colored deadline treatment (`font-mono text-xs tabular-nums` + `urgent ? text-brand : text-muted-foreground`) that `DeadlineText` already owns. **Related theme:** the same "mono note under a title" style is copied in 5 places — `group-tile.tsx:97`, `start-lab-card.tsx:60`, `student-lab-groups.tsx:80` & `:135`, `teacher-lab-groups.tsx:390` — none via `Text`.
**Cost:** urgency-color rule + note typography live in many files and drift when one is retuned.
**Proposed fix:** export a shared `urgentTextClass(urgent)` (or colored-text component) for both deadline spots; add a `Text` note variant for the mono-note copies.
**Decision:** —
**Notes:** —

### S4 — `hub/enrolled-class-card.tsx:53` · low · 🔲 Open
**Issue:** reimplements the `teacher${n===1?"":"s"}` pluralization and people-mapping that `class-card.tsx:22` (`peopleLabel` + `withUser`) already encapsulate.
**Cost:** two copies of the same label/shape logic across teacher and student cards.
**Proposed fix:** lift `peopleLabel` (and optionally the people-mapping) to a shared module both cards import.
**Decision:** —
**Notes:** —

### S5 — `pages/join-page.tsx:243` · med · 🔲 Open
**Issue:** ready-state renders a four-way nested ternary (`none`→`pending`→`isOwner`→enrolled), each arm a full CTA block (~75 lines).
**Cost:** hard-to-scan JSX that worsens per membership variant.
**Proposed fix:** extract a per-membership CTA subcomponent (or a switch returning the block).
**Decision:** —
**Notes:** —

### S6 — `labs/lab-row.tsx:123` · low · 🔲 Open
**Issue:** `onClick` guard `closest("[data-stop-link]")` never matches — no element sets that attr (grep-confirmed); the comment claiming the badge marks itself is false.
**Cost:** dead defensive code + a lying comment; the intended "don't navigate on badge click" never fires.
**Proposed fix:** drop the guard (badge is a hover tooltip, harmless), or actually add `data-stop-link` to the `TooltipTrigger` span if the stop is wanted.
**Decision:** —
**Notes:** —

### S7 — `routes/*` (7 modules) · med · 🔲 Open
**Issue:** identical `<Auth>…</Auth>` gate copy-pasted into 7 route files.
**Cost:** an auth-gate policy change means editing 7 files.
**Proposed fix:** a pathless `layout("routes/auth-layout.tsx")` rendering `<Auth><Outlet/></Auth>`. `onboarding.tsx` (passes `requireGithubLinked={false}`) legitimately stays outside it.
**Decision:** —
**Notes:** —

### S8 — `routes/onboarding.tsx:16` · low · 🔲 Open
**Issue:** unlike every sibling (pure wiring), this route hosts behavior — `OnboardingContent` reads `useAuth()` and redirects already-linked users.
**Cost:** page-gating logic in the route layer breaks the "route = thin wire" convention and hides the decision.
**Proposed fix:** push the already-linked redirect into `OnboardingGitHubPage` (or the Auth layer).
**Decision:** —
**Notes:** —

### S9 — `typography/text.tsx:35` · low · 🔲 Open
**Issue:** `CAPS_LABEL` is an exported raw class string beside the `VARIANT` map, so caps-label typography exists in two mechanisms (`variant` map vs. hand-applied constant).
**Cost:** consumers write `className={CAPS_LABEL}` instead of `<Text variant=…>`, splitting the type system and letting them drift.
**Proposed fix:** make it a color-less `variant` (e.g. `"capsLabel"`); consumers add color via `className`.
**Decision:** —
**Notes:** —

### S10 — `groups/student/start-lab-card.tsx:113` · low · 🔲 Open
**Issue:** the final `repoFullName !== null ? … : null` arm is unreachable — reaching it implies `state === "clone"`, which already means non-null.
**Cost:** dead arm kept only to re-narrow a type `created` doesn't carry.
**Proposed fix:** narrow via the `created` const or an early return.
**Decision:** —
**Notes:** —

---

## Organization, naming & typing

### O1 — `lib/api.ts:33` · med · 🔲 Open
**Issue:** lab-feature endpoint nodes (`labGroupsApi`, `reusableGroupsApi`) and row types (`GroupItem`, `LabStudent`, `ReusableGroup`) live in the generic client module beside `useApi`/`useAction`.
**Cost:** the shared api module accretes per-feature surface; readers can't tell generic client from lab specifics; unrelated routes pull them into scope.
**Proposed fix:** colocate the lab-specific endpoint+type exports with the lab feature (they only need the exported `api` client).
**Decision:** —
**Notes:** —

### O2 — `lib/api.ts:54` · low · 🔲 Open
**Issue:** the JSDoc describing `useApi` (SWR GET hook) is stranded above `useAction` (71); the real `useApi` (113) is undocumented.
**Cost:** the two most-used exports are mislabeled/undocumented.
**Proposed fix:** move the block down to sit immediately above `export function useApi`.
**Decision:** —
**Notes:** —

### O3 — `routes.ts:5` · med · 🔲 Open
**Issue:** class-id URL param is `:classId` in lab routes but `:id` in `class-confirm`/`reconcile` for the same concept.
**Cost:** consuming pages must `useParams()` two different keys for one domain id — easy to grab the wrong key when copying a route.
**Proposed fix:** standardize on `:classId` across all four routes.
**Decision:** —
**Notes:** —

### O4 — `identity/org-identity.tsx:20` & `identity/user-avatar.tsx:28` · low · 🔲 Open
**Issue:** neither exposes a `className` prop (sibling `UserIdentity` does); `user-avatar`'s `square` branch monopolizes `className` so even shadcn overrides are blocked.
**Cost:** callers must wrap with an extra `Stack`/`div` to position/space, violating the shared-primitive bar.
**Proposed fix:** accept `className`, merge last via `cn()` (`user-avatar`: `cn(square && "rounded-md after:rounded-md", className)`).
**Decision:** —
**Notes:** —

### O5 — `identity/*` size scales · low · 🔲 Open
**Issue:** three sibling primitives use three different size scales — `UserAvatar` sm/default/lg, `UserIdentity` sm/lg, `OrgIdentity` default/lg — where `default` means different pixels.
**Cost:** "one concept, one name" broken; reading one component's size doesn't predict another's.
**Proposed fix:** settle on a single shared `Size` union / token type across the identity folder.
**Decision:** —
**Notes:** —

### O6 — `groups/student/student-lab-groups.tsx:80` · low · 🔲 Open
**Issue:** conditional `className` is a whole-string ternary (`mine ? "font-mono text-role-enrolled text-xs" : "font-mono text-muted-foreground text-xs"`) instead of `cn()`.
**Cost:** shared classes duplicated; Tailwind conflicts wouldn't dedupe.
**Proposed fix:** `cn("font-mono text-xs", mine ? "text-role-enrolled" : "text-muted-foreground")`. *(Overlaps the "mono note" theme in S3 — resolve together.)*
**Decision:** —
**Notes:** —

### O7 — `routes/connect-failed.tsx:4` · low · 🔲 Open
**Issue:** the only route module missing the `/** /path — purpose */` doc comment all eight siblings carry.
**Cost:** inconsistent self-documentation.
**Proposed fix:** add the one-line route-purpose comment.
**Decision:** —
**Notes:** —

---

*Log: 2026-07-11 — tracker created from full-codebase frontend-review on `main` @ `7f3d62f`; milestone-7-frontend-quality branched off `main`.*
