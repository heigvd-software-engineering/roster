# aiview

Local Markdown viewer with a document index. Renders `.md` files (GFM + mermaid) at
`http://localhost:4321`, live-reloads on save, and keeps an index of every document it has been given (path,
project, title, kind, tags, start time) so earlier work is one click away.

Made for skills that produce living documents — a brainstorm board, a PR analysis, a
review report. The viewer knows nothing about those use cases: each document carries one
mandatory **kind** (`brainstorm`, `pr-analysis`, …) shown as a coloured chip, free **tags**
(grey chips), and its **start date-time**.

## Requirements

Node ≥ 22.5 (built-in `node:sqlite`; tested on Node 24). No `npm install`, no native
modules. Windows and macOS.

## Usage

```sh
node .claude/tools/aiview/aiview.mjs add   docs/specs/2026-08-17-topic.brainstorm.md --tag roster --tag autograding
node .claude/tools/aiview/aiview.mjs add   notes/pr-142.md --kind pr-analysis --started 2026-08-17T09:30+02:00
node .claude/tools/aiview/aiview.mjs serve docs/specs/2026-08-17-topic.brainstorm.md --open   # --port 4321
node .claude/tools/aiview/aiview.mjs list  --kind brainstorm --tag roster
```

(Repo copy: run from the repo root; the canonical source lives in the user's `C:/SKILLS/dev/tools/aiview`.)

- **add** — register a document. **Kind is mandatory**: from the filename convention
  `<name>.<kind>.md` (`….brainstorm.md` → `brainstorm`) or `--kind`; `add` refuses
  otherwise. Tags via `--tag` (repeatable). Start date-time = first registration, or
  `--started <ISO>` to set it explicitly. All of this is set by the agent, never by hand
  in the UI.
- **serve** — start the viewer; with a file, registers and opens it (`--open` launches
  the browser via `start` / `open` / `xdg-open`). Without a file, opens the index.
- **list** — documents in the index, optionally filtered by kind/tags.
- **remove** `<file|#id>…` — drop entries from the index; the files are never touched.

## UI

Left: **Documents** (newest start first) — search box, **Kind** row (coloured chips, deterministic hue per
kind, click to filter) and **Tags** row (grey chips, multi-select), then the list: kind
chip + **start date-time** (monospace, prominent), title, tags, project, last update;
missing files struck through. Right: header (kind · started · tags · project · updated)
and the rendered document; reloads when the file changes. `#doc=<id>` selects a doc.

## Storage

`aiview.sqlite` **next to `aiview.mjs`**, one table `documents`, single-file journal — so a repo
that vendors the tool versions its index too and the same list appears on every machine
after a checkout. Document paths are stored relative to the repo root (nearest `.git`
above the tool), absolute only for files outside it. Files are the truth; the index only points.

## Layout

`aiview.mjs` (server + CLI) · `ui.html` (viewer) · `vendor/` (marked, mermaid — fetched once from jsdelivr on first `serve` if missing, then offline; a repo copy can gitignore it).
