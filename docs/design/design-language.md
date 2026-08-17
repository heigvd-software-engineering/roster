# roster — design language

_Extracted 2026-08-17 from `apps/www`. Every claim cites its file. Re-extract when `app.css`, `components/ui/` or the `custom/` vocabulary change._

## Tokens (`apps/www/app/app.css`)

The **stock shadcn neutral theme, unmodified except the two fonts** — the file says so and it holds: no app-specific hues; state is expressed with the stock tokens (`foreground` / `muted-foreground` / `destructive`) and shadcn's own Badge/Button variants. Everything is greyscale in OKLCH; the only chroma is `destructive` and the unused `chart-*`.

```css
:root {                                   /* light */
  --background: oklch(1 0 0);      --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);            --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);     --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);    --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);        --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);       --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);      --input: oklch(0.922 0 0);   --ring: oklch(0.708 0 0);
  --radius: 0.625rem;              /* sm = r-4px, md = r-2px, lg = r, xl = r+4px */
  --font-sans: "Geist Variable";   --font-mono: "Geist Mono Variable";
}
.dark {                                   /* toggled by class on <html> */
  --background: oklch(0.145 0 0);  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);        --primary: oklch(0.922 0 0);   --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);   --muted: oklch(0.269 0 0);     --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);      --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);    --input: oklch(1 0 0 / 15%);   --ring: oklch(0.556 0 0);
}
```
Shadows: effectively none in the app's own components (Card is a border, not a shadow). Icons: lucide, `size-3.5` in chips/hints, `size-4` in buttons.

## Type scale & rhythm

One typography component, `Text` (`components/custom/typography/text.tsx`):

| variant | classes | element |
|---|---|---|
| title | `text-3xl font-semibold tracking-tight` | h1 |
| heading | `text-xl font-semibold tracking-tight` | h2 |
| subtitle | `text-base text-muted-foreground` | p |
| body1 | `text-base` | p |
| body2 | `text-sm text-muted-foreground` | p |
| label | `text-sm` | p |
| caption | `text-xs text-muted-foreground` | p |
| error | `text-sm text-destructive` | p |

Numbers are `tabular-nums` wherever they line up (deadlines, stats, counts). Spacing scale is closed (`layout/tokens.ts`): `xs 4 · sm 8 · md 16 · lg 24`. **One step, `lg` (24px), rules the page body** — header → content and between sibling blocks (`layout/page.tsx`); the app bar gets 28px above the page. Content column: `max-w-5xl`, `px-6 md:px-10` (`layout/container.tsx`).

## Component vocabulary (the words the codebase already uses)

| Name | Purpose | Defined in |
|---|---|---|
| `Page`, `Container`, `Stack`, `Row` | the only layout primitives; gap/align/justify from the closed token sets | `custom/layout/` |
| `Text` | all typography (see scale) | `custom/typography/text.tsx` |
| `LabHeader` | breadcrumb `‹ Classes / <class>`, then title + mode Badge + `DeadlineText` + formatted deadline + `LabStatusHover`, role chip + whole-lab actions on the right | `custom/classes/labs/lab-header.tsx` |
| `LabStats` | summary strip: hairline-separated numbers in one Card ("do I need to look closer at all?"), `value/total`, `alert` → destructive when > 0 | `custom/classes/groups/teacher/lab-stats.tsx` |
| `StatusChip` | a group's lab status as Badge — `late` is the **only** destructive one; settled states `secondary`, unsettled `outline` | `custom/classes/groups/teacher/group-status.tsx` |
| `LastPush`, `CommitByline` | activity line: last push as a moment, distance to deadline, `@login · message` truncated | same |
| `GroupCard`, `GROUP_WALL` | the wall: auto-fill grid capped at 3 columns, cards stretch per row, roster inline, footer pinned (repo + last push), status badge in the corner, kebab for the rare verb | `custom/classes/groups/shared/group-card.tsx` |
| `SizeCount`, seats (`SeatButton`, `JoinSeat`/`VacantSeat`/`LockedSeat`) | count beside the name (destructive only when the size is the problem), open seats as affordances | `group-card.tsx`, `seats.tsx` |
| toolbar in `TeacherLabGroups` | search `Input` + `ToggleGroup` status segments (all / attention / late) that **dim** non-matching cards instead of hiding them | `teacher/teacher-lab-groups.tsx` |
| `Hint` | tiny ghost icon button explaining itself in a click popover; variants info / warning / error (only error is coloured) | `custom/hint.tsx` |
| `StateChange` | `from` outline Badge → arrow → `to` secondary Badge (reconcile) | `custom/state-change.tsx` |
| `DisclosureToggle` | the one expand/collapse affordance: ghost chevron, accessible label says what it discloses | `custom/disclosure-toggle.tsx` |
| `ConfirmDialog`, `DeleteDialog` (+ `STAKES`) | destructive verbs always behind a dialog that **counts what it takes** ("3 teams, 8 students…") | `custom/confirm-dialog.tsx`, `delete-dialog.tsx` |
| `CommandBlock` | copyable `<pre>` with a copy button that flips to a check | `custom/command-block.tsx` |
| `RepoLink`, `MissingRepoBadge` | repo pill opening GitHub; missing repo turns into a fix (unlink) | `groups/shared/work-repo.tsx` |
| `RoleChip`, `PeopleChip`, `UserIdentity`, `UserAvatar` | people & role marks | `custom/classes/role-marker.tsx`, `identity/` |
| `Loading` | page-level loading wrapper | `custom/loading.tsx` |
| shadcn kit in use | Avatar, Badge, Button (`default/secondary/ghost/destructive…`, sizes `xs/sm/default/icon/icon-xs/icon-sm`), Card, Dialog, DropdownMenu, Input, Label, Popover, Select, Switch, Table, Toggle, ToggleGroup, Tooltip | `components/ui/` |

## Layout patterns (cite: `pages/teacher-lab-page.tsx`, `teacher-lab-groups.tsx`, `pages/reconcile-page.tsx`, `labs-table.tsx`)

- **App shell** (`shell/app-header.tsx`): full-bleed bottom border, `roster` wordmark left, account menu right, `py-3`; then `Page` (Stack, gap lg, `pt-7`) inside `Container`.
- **Lab page** = `LabHeader` → `LabStats` strip → toolbar (search + segments + primary action on the right) → the **group wall**. Management lives ON the card; nothing hides behind disclosures at class scale (~12 groups). Filtering dims, never hides.
- **Lists of things**: cards when each thing has inner structure and actions (groups); a plain `Table` when rows are homogeneous fields (labs in the class card, findings). Chronological order where time matters.
- **Reconcile page**: sections in reading order, each finding one row with severity Badge, `StateChange from → to`, a checkbox only when a fix exists (unfixable = reported, not offered), one `Apply` for the checked set. Audit reads, Apply writes — the read/write split is visible.
- **Dialogs**: shadcn Dialog; destructive ones through `DeleteDialog` with stakes; footer buttons right-aligned, destructive last.
- **Primary actions**: right end of the toolbar/header row (`Row justify="between"`); the rare verb (delete) in a kebab or ghost `sm` button with a muted icon.
- **Empty & unknown**: an empty lab "says so rather than listing three zeroes" (`labStakes`); unknown activity degrades to "activity unknown" chips, never to a wrong verdict; heuristics carry a visible `Hint` caveat.

## States & feedback

- Loading: `Loading` wrapper on the page; buttons `disabled` while `busy`. Errors: `Text variant="error"` inline plus a global failure strip (`useAction`). Not-found vs transient are distinct sentences.
- Status is form before words: Badge variant carries the meaning (destructive = act now, secondary = settled, outline = unsettled/unknown), destructive text only when the number is the problem.
- Copy strings are lowercase chips (`on track`, `late`, `no repo`), sentence-case everywhere else.

## Voice (cite: page copy, `docs/nomenclature.md`)

- One concept, one word: **class · lab · group · work repo · starter code · teacher · student**; verbs **connect · link · join · accept · reconcile** ("GitHub sync" as the teacher-facing label). No synonyms.
- Sentence case; buttons name the outcome ("Delete lab", "Apply"); dialog trigger and dialog action never share the same words (`aria-label` differs). Errors are one plain sentence with the way out ("Couldn't load this lab — refresh to retry.").
- Explanatory comments in code are long; UI text is short.

## Don't (things this codebase avoids)

- No custom hues, no gradients, no shadows, no illustration; grey + one destructive red.
- No third status colour: green/amber "success/warning" chips don't exist — settled is `secondary`, unsettled is `outline`, act-now is `destructive`.
- No hiding by filter (dim instead), no hover-only meaning (Hints are click), no bespoke recovery UIs (turn the failure into the existing fix).
- No raw Tailwind ladders in call sites: every visual thing has a name.

## Open questions for the design owner
- Grading will introduce **scores** — numbers with a max. `LabStats`' `value/total` and `tabular-nums` are the existing shape for that; is a per-cell "score" ever coloured, or is form (chip variant) enough?
