---
name: aiview
description: Use whenever a skill or task produces a document the user should look at while it evolves — a brainstorm board, a spec, a design language, an HTML mockup, a PR analysis, a review report. aiview renders Markdown (GFM + mermaid) and HTML mockups on localhost with live reload and keeps a versioned, tagged index of every such document. This skill is the contract for using it; do not improvise around it.
---

# aiview — the contract

aiview is a local viewer + index for documents the agent writes for a human to read. The
**files are the truth** (they live in the repo, under `docs/`); the index (`aiview.sqlite`
next to the tool) only points at them, and is versioned with the repo so the list is the
same on every machine.

Where the tool is: `.claude/tools/aiview/aiview.mjs` in a repo that vendors it (run from the
repo root), or `C:/SKILLS/dev/tools/aiview/aiview.mjs` for the canonical copy. Node ≥ 22.5,
no install; it fetches its two browser libs on first run.

## When to use

- You are about to write a document meant to be **read and reacted to**: board, spec,
  reference (design language, decision record), mockup, analysis, report.
- Not for code, tests, configs, or files nobody opens in a browser.

## The three rules

1. **Register on creation, with the right kind.** Every document has exactly one mandatory
   **kind** — from the filename `<name>.<kind>.md|html` (preferred) or `--kind`. Kinds in
   use: `brainstorm`, `spec`, `reference`, `mockup`, `pr-analysis`, `report`. Pick an
   existing one before inventing a new one; a new kind is a new colour chip everyone
   sees, so it should name a *type of document*, not a topic. Topics go in **tags**
   (`--tag <project> --tag <feature>`), which are free.
2. **Set the start date-time honestly.** `created_at` = when the work on that document
   began. Registration time is right if you register as you create; pass
   `--started <ISO>` when the discussion started earlier than the file.
3. **Never edit `aiview.sqlite` by hand and never register scratch files.** The index is
   part of the repo's history. Use `add` / `remove`; scratch, temp and generated files
   stay out.

## Commands

```sh
A="node .claude/tools/aiview/aiview.mjs"
$A add   docs/specs/2026-08-17-topic.brainstorm.md --tag roster --tag topic [--started 2026-08-17T14:15+02:00]
$A add   docs/design/mockups/2026-08-17-screen.mockup.html --tag roster --tag topic
$A serve docs/specs/2026-08-17-topic.brainstorm.md --open     # start viewer, open browser (port 4321, --port to change)
$A list  [--kind brainstorm] [--tag roster]                     # what exists, newest start first
$A remove docs/old.md | #12                                     # index only, file untouched
```

`serve` runs one server for all documents: start it **once**, in the background, tell the
user the URL (`http://localhost:4321/#doc=<id>`), and keep editing the files — the page
reloads on save. If a server is already running, just `add`; the sidebar picks it up on
the next reload. Restart the server only after changing the tool itself.

## What the user sees

Left: documents newest-start first — start date-time (left), kind chip (right), title,
tags, project, last update; kind chips and tag chips filter. Right: the document title,
its header line, and the rendered document. HTML mockups render in a sandboxed iframe
with viewport presets (mobile / tablet / laptop / full).

## Conventions that keep the index useful

- File names: `YYYY-MM-DD-<topic>.<kind>.md` under `docs/specs/`, `docs/design/`,
  `docs/design/mockups/`, `docs/analysis/`… — the date is the start date.
- One document per subject; iterate the same file rather than creating v2 files.
  A rejected variant is **removed** from the index (and usually deleted).
- When a board produces a spec, note it at the top of the board and register the spec
  with kind `spec`.
- Mockups: HTML, self-contained, tokens from the project's design language (see the
  `frontend-design` skill).

## Red flags

| Thought | Reality |
|---|---|
| "I'll show it as a claude.ai artifact instead" | The user asked for local, versioned, offline. Use aiview. |
| "I'll register it later" | Later never comes; the start time is wrong and the doc is invisible. Register on creation. |
| "This needs a new kind: `autograding`" | That's a topic → tag. Kinds are document types. |
| "I'll clean up by deleting rows in the sqlite" | Use `remove`; the DB is versioned and shared. |
