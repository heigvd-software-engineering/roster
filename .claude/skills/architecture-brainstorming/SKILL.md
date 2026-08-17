---
name: architecture-brainstorming
description: Use before building anything non-trivial — a new feature, service, integration, or system — to turn an idea into an approved spec and an implementation plan, with architecture diagrams. Covers the design conversation itself: requirements, approaches, boundaries, data flow. Not for bug fixes or mechanical edits.
---

# Architecture brainstorming

Turns an idea into a design, a written spec, and a plan — through questions, not
assumptions — and **draws the design while discussing it.**

A diagram here is a thinking tool, not decoration. Its job is to make a boundary,
an ordering, or a dependency visible early enough to argue about cheaply.

<HARD-GATE>
No implementation, no scaffolding, no code, no file creation for the thing being
designed until the spec is written and the user has approved it. Every project, however
simple. A simple project's spec is three paragraphs — but it exists and it's approved.
</HARD-GATE>

## Flow

1. **Read the context** — existing code, `AGENTS.md`/`CLAUDE.md`, recent commits, the
   conventions already in force. Design that fights the house rules is wasted design.
2. **Scope check** — if the request is several independent systems, say so now and help
   decompose it. Each piece gets its own spec. Don't refine details of a project that
   needs splitting first.
3. **Question loop** — one question per message. Multiple choice where the options are
   knowable; open-ended where they aren't. Understand purpose, constraints, success
   criteria, and what's explicitly out of scope.
4. **Approaches** — propose 2–3 with real trade-offs. Lead with your recommendation and
   why. YAGNI every one of them before presenting.
5. **Design, in sections** — scale each section to its complexity. Ask after each one
   whether it holds before moving on.
6. **Write the spec** → self-review → user reviews it.
7. **Write the plan** — phased, each phase independently verifiable.

## The board (live document)

The design lives in one Markdown file from the first question, not in chat. Create
`docs/specs/YYYY-MM-DD-<topic>.brainstorm.md` (user's stated location wins) as soon as
the context is read, and keep every decision, open question, considered option, diagram,
and research note in it — the chat is transient, the board is the record. Structure:
decisions table (status: agreed / proposed / open / deferred), context being built on,
design sections, diagrams, research notes.

Render it with **aiview** (contract: the `aiview` skill) so the user sees
diagrams and edits live. Register it the moment you create it — kind `brainstorm` (from
the `.brainstorm.md` suffix, mandatory), tags for project and topic, and the start
date-time (registration time, or `--started` if the discussion began earlier) — then serve:

```sh
node .claude/tools/aiview/aiview.mjs add   docs/specs/YYYY-MM-DD-<topic>.brainstorm.md --tag <project> --tag <topic>
node .claude/tools/aiview/aiview.mjs serve docs/specs/YYYY-MM-DD-<topic>.brainstorm.md --open
```

Start it once in the background, tell the user the URL, and keep editing the same file —
it reloads on save. The index (`aiview.sqlite` next to the tool) is versioned with the repo,
so resuming on another machine needs no re-registration: `aiview list --kind brainstorm`
shows every board with its start date-time; read the relevant one before asking the user anything again.

## Diagrams

**Pick by the question on the table, not by ritual.** `diagrams.md` maps each open
question to the diagram that answers it — what runs where (container), in what order
(sequence), what states are legal (state machine), what may import what (dependency),
where untrusted input enters (data flow). Read that file before drawing.

**A diagram is often the cheapest way to ask a question.** Draw the container diagram
with a `?` on the contested arrow and ask "which of these two?" — that settles in one
exchange what two paragraphs of prose won't. Use diagrams during the question loop,
not only in the spec.

**Discipline — otherwise it's diagram soup:**

- One diagram per open question. A diagram that restates a paragraph is noise; delete it.
- Draw it only if it shows something you can't say in one sentence. If you can say the
  sentence, say the sentence.
- **Every arrow is labeled** with what flows and in which direction. An unlabeled arrow
  means "these are related somehow," which is worth nothing.
- Real names of real things — actual service, table, and module names, not `Service A`.
- A box whose responsibility you can't state in a phrase gets deleted.
- 2–4 diagrams for a feature. The full C4 set only for a genuinely new system.
- When the design changes in review, **update the diagram in the same edit.** A stale
  diagram is worse than no diagram, because it gets believed.

Mermaid in fenced ```mermaid blocks, so it renders in the repo with no tooling.

## Approaches

Present options conversationally with the trade-off that actually decides it — not a
feature matrix. When the options differ structurally, draw them: two small container
diagrams side by side beat two paragraphs. Say which you'd pick and why.

## The spec

Write to `docs/specs/YYYY-MM-DD-<topic>.md` (a user's stated location wins). Contents:

**Problem** — what's wrong today, who feels it · **Goals / non-goals** — the non-goals
are the valuable half · **Design** — prose plus the diagrams that earned their place ·
**Data** — shapes, ownership, migrations · **Failure modes** — what breaks, what the
user sees · **Testing** — what proves this works · **Open questions** — with a named
owner, or none at all.

Then self-review with fresh eyes and fix inline: any TBD or placeholder left? Do two
sections contradict each other? Does every diagram match the prose beside it? Could a
requirement be read two ways — if so, pick one and write it plainly. Is this one
implementation plan's worth of work, or does it still need splitting?

Then stop and ask the user to review the file before you write the plan.

## The plan

Only after the spec is approved. Phases, each one independently verifiable — a phase
whose completion you can't check isn't a phase. Per phase: what changes, which files,
how it's verified, and what it unblocks. Carry the relevant diagram into the phase that
implements it. Order by dependency, and put the riskiest unknown first — that's where
the plan will change.

## Red flags

| Thought | Reality |
|---|---|
| "This is simple, I'll just build it" | The gate applies to every project. Simple ones are where wrong assumptions hide. |
| "I'll draw the diagram after" | Then it's documentation, not design. Its value was in the argument you skipped. |
| "The user knows what they want" | They know the outcome. The boundaries are what you're for. |
| "Let me scaffold while we talk" | Files created before approval get defended instead of discarded. |
| "One more diagram would help" | Would it answer an open question? If not, it's soup. |
