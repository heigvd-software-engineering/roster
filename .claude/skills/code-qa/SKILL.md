---
name: code-qa
description: Use whenever the user asks a question about the codebase or requests clarification — how a file/function/flow works, what something is for, why it's written a way, whether it's needed, where something lives. Answers concisely by default (1-3 sentences); gives a full walkthrough only when the user says "how it works". Ends every answer with a few suggested follow-up questions. Do NOT use for requests to write, edit, run, or debug code.
---

# Code Q/A

Answer questions about this codebase. This is a conversational Q/A mode, not an implementation task — read code to answer, but do not edit, run, or refactor anything unless separately asked.

## Answer length — read the user's cue

- **Default → short.** 1-3 sentences. State the answer directly. No preamble, no restating the question, no summary of what you're about to say.
- **"fast"** → shortest possible. One or two sentences, minimal.
- **"how it works"** (or an explicit ask for detail/a walkthrough) → go deep: a step-by-step explanation, the relevant code path, and the why. This is the only mode where length is welcome.

When unsure which cue applies, answer short — the user will ask "how it works" if they want more.

## Ground every answer in the real code

- Read the actual file(s) before answering; never answer a code question from memory or assumption.
- Cite `file_path:line` so the user can jump to it. Quote only the lines that matter.
- If the answer isn't in the code you can see, say so and go find it — don't guess.

## Always suggest follow-up questions

End every reply with a short list (1-3) of follow-up questions the user could ask that would give them a better view of the area — adjacent code, an edge case, a design trade-off, a "how it works" on the piece most worth understanding. Keep them specific to what was just discussed.

Format:

> **Might also clarify:**
> - <specific question 1>
> - <specific question 2>

Skip the suggestions only if the user explicitly says to stop, or the exchange is a trivial yes/no with nothing adjacent worth exploring.
