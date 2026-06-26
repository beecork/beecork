# Eval harness

Measures the agent objectively: runs it on tasks with deterministic checkers and
prints a success rate. This is how we tell if a change (prompt / tool / model)
actually helped — instead of guessing.

## Run it

```bash
npm run eval
# try a different model:
OPENROUTER_MODEL=z-ai/glm-5.2 npm run eval
```

## A task

Each task in `run.ts` is `{ name, prompt, setup?, check }`:

- **prompt** — what we ask the agent to do.
- **setup** — optional starting files (created in a fresh temp dir).
- **check(dir, output, trace)** — objective pass/fail. It can look at:
  - **`dir`** — the files the agent produced/changed,
  - **`output`** — what the agent printed,
  - **`trace`** — the list of tool calls it made (`{tool, args, step}`), so you can
    grade *how* it worked, not just the result.

Three kinds of check, in order of preference:
1. **File/output checks** (deterministic) — `file contains "8080"`.
2. **Trace checks** (deterministic) — `usedTool(trace, "edit_file") && !usedTool(trace, "write_file")`.
3. **LLM-judge** (`judge(criterion, content)`) — for subjective quality only.
   Noisy (judges are unreliable), so gate it behind a cheap code-check first.

## The flywheel (turning real failures into tasks)

This is how the suite grows to mirror reality:

1. While using the agent (`npm run dev`), when it does badly, type **`/bad`** — the
   conversation is saved to `eval/failures/`. (`/good` saves to `eval/good/`.)
2. Later, open a saved failure, decide what "correct" would have been, and add a
   new task to `run.ts` with a checker that captures it.
3. Re-run `npm run eval`. The new task currently fails (that's the bug, pinned).
4. Fix the prompt/tool/loop until it passes — **and the whole suite still passes**
   (no regressions). The task stays forever as a guard.

Over time, `eval/failures/` feeds `run.ts`, and the score starts tracking what
actually matters. (Raw transcripts in `failures/`/`good/` are gitignored — commit
the distilled *tasks*, not the raw logs.)

## Deferred: self-improvement loop

A GEPA-style loop (reflect on failures → propose a prompt/tool tweak → re-run →
keep only if the score improves, with a held-out slice to catch overfitting) is
the planned next phase — worth building only once this suite is broad enough that
optimizing against it isn't just overfitting a handful of tasks.
