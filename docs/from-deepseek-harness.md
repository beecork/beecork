# Improving beecork with lessons from DeepSeek Harness

> **REVIEWED AND IMPLEMENTED (2026-08-19).** Every factual claim below was checked against the real
> source before any of it was built. Most held up — the central one exactly — but the priorities did
> not, and three claims were wrong or already-done. The verified findings, the corrections, the
> decisions (including two items deliberately NOT built) and the build log live in
> [`.claude/think-it-through/from-deepseek-harness-review.md`](../.claude/think-it-through/from-deepseek-harness-review.md).
> Read that first; this document is the original proposal, kept as written.

**Purpose.** This document turns a code-level comparison of beecork and
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into an implementation brief for
beecork. It explains the architectural differences, decides which ideas fit beecork, and gives a
safe order in which to build them.

This is not a proposal to turn beecork into DeepSeek Harness. DeepSeek Harness is an extensible agent
platform with a web application, SDKs, protocol servers, many persistence backends, and a large plugin
graph. beecork is a focused, terminal-first coding agent whose small and readable implementation is a
product advantage.

The goal is to copy the principles that improve correctness and safety while preserving beecork's
identity:

1. small and transparent;
2. model-agnostic through OpenRouter;
3. safe by default;
4. token-economical;
5. BYOK with no telemetry or surprise network access.

---

## Executive decision

The most important difference is:

> DeepSeek Harness records an agent run as a durable sequence of facts. beecork primarily keeps a
> mutable list of chat messages.

beecork should adopt the **principle** behind DeepSeek Harness's event history, but not copy its full
event framework or plugin architecture.

The five primary improvements found in this comparison should all be addressed, but not all with the
same urgency or scope:

| Improvement | Decision | Priority | Scope for beecork |
|---|---|---:|---|
| Durable execution journal | **Build** | P0 | A small append-only event log; do not copy the whole DeepSeek session subsystem |
| Structured tool outcomes and lifecycle | **Build** | P0 | Typed results and a compact execution pipeline around the existing tools |
| Real OS-level process sandbox | **Build** | P0 security | Add confinement beneath current approvals and guards; retain existing policy checks |
| Deterministic whole-agent replay tests | **Build** | P1 | Record model streams, run the real loop, and assert transcript plus filesystem state |
| Model-aware context and overflow recovery | **Build incrementally** | P1 | Start with model limits, output reserve, pruning, and overflow retry; skip elaborate compaction transactions initially |

A sixth improvement—moving global state into a per-agent runtime—is recommended after the P0 work
because it makes the first five easier to test and extend. It does not require a plugin framework.

---

## 1. Mutable transcript versus durable event history

### The plain-language version

A chat transcript answers:

> What messages should we send to the model next?

An execution history answers:

> What actually happened during this agent run?

Those are related, but they are not the same thing.

beecork currently makes the chat transcript carry both responsibilities. Its main state is an array
like this:

```text
user message
assistant tool call
tool result
assistant answer
```

The loop pushes and removes entries in that array as work proceeds. Before a turn, it takes a shallow
snapshot. If the turn fails or is cancelled, it returns the snapshot to restore a structurally valid
conversation.

That is a good way to keep an API message list valid. It is not a complete record of execution.

DeepSeek Harness instead records facts such as:

```text
turn started
user message accepted
step started
model request started
assistant message received
tool call started
approval granted
tool call completed
step ended
turn ended with completed/error/cancelled
```

These facts are appended and are not rewritten when later work fails. The message list sent to the
model is a **projection** derived from those events.

### A concrete failure in the current model

Suppose a turn performs this sequence:

1. The model calls `edit_file`.
2. `edit_file` changes `src/api.ts` successfully.
3. beecork asks the model for the next step.
4. OpenRouter returns an error, or the user presses Ctrl-C.
5. beecork restores the earlier message snapshot.

The filesystem still contains the edit. The conversation no longer contains the tool call or its
successful result. On resume, the model may believe the edit never happened.

The mutable history has become inconsistent with the world:

```text
transcript:  no edit happened
filesystem:  edit happened
```

This does not mean an event log would undo the edit. It would do something more honest and useful:

```text
tool edit completed successfully
subsequent model request failed
turn ended with error
```

Recovery can then derive a valid model transcript that says the edit happened and the turn was
interrupted. Debugging, resume, evaluation, and user-facing diagnostics all start from the same facts.

### Is beecork's current history a disadvantage?

For a simple chatbot, no. A mutable `Message[]` is direct, readable, and sufficient.

For present-day beecork, yes. beecork now has:

- filesystem mutation;
- shell commands and background processes;
- parallel tool calls;
- approvals;
- mid-turn steering;
- cancellation;
- session persistence and resume;
- compaction;
- MCP tools with unknown external effects.

Once external side effects and recovery exist, a chat transcript is no longer rich enough to be the
only history.

### Should beecork work exactly like DeepSeek Harness?

No. It should adopt three invariants from DeepSeek Harness:

1. **Observed facts are append-only.** Do not erase a successful tool execution because later work
   failed.
2. **Every turn closes explicitly.** Completed, cancelled, blocked, and failed are data, not merely
   control flow.
3. **Everything shown to the model is reconstructable.** The model transcript is derived from durable
   facts or from clearly identified ephemeral instructions.

It does not initially need:

- raw token-chunk persistence;
- declaration-merged event types;
- SQLite;
- multiple session projections for web, ACP, and SDK clients;
- a general event plugin bus;
- cross-process concurrent writers.

---

## 2. Proposed beecork execution model

### Minimal event vocabulary

Start with a deliberately small union:

```ts
type AgentEvent =
  | { seq: number; time: string; type: "session_started"; sessionId: string }
  | { seq: number; time: string; type: "turn_started"; turnId: string; input: Message }
  | { seq: number; time: string; type: "steering_added"; turnId: string; content: string }
  | { seq: number; time: string; type: "step_started"; turnId: string; step: number }
  | { seq: number; time: string; type: "assistant_message"; turnId: string; step: number; message: Message }
  | { seq: number; time: string; type: "tool_started"; turnId: string; step: number; call: ToolCall }
  | { seq: number; time: string; type: "approval_resolved"; callId: string; decision: ApprovalDecision }
  | { seq: number; time: string; type: "tool_finished"; callId: string; outcome: ToolOutcome }
  | { seq: number; time: string; type: "step_finished"; turnId: string; step: number }
  | { seq: number; time: string; type: "compaction_applied"; checkpoint: CompactionCheckpoint }
  | { seq: number; time: string; type: "turn_finished"; turnId: string; outcome: TurnOutcome };

type TurnOutcome =
  | { status: "completed" }
  | { status: "cancelled"; reason?: string }
  | { status: "error"; error: AgentError }
  | { status: "step_limit" };
```

`seq` supplies deterministic ordering. `turnId`, `step`, and `callId` make causal relationships
explicit. Timestamps are for human diagnostics and should not define ordering.

### Projection, not duplication

Add one pure function:

```ts
function deriveMessages(events: readonly AgentEvent[]): Message[];
```

It should:

- include accepted user input and steering;
- include complete assistant messages;
- include tool calls and completed tool outcomes in provider-valid order;
- represent interrupted work without creating orphan tool calls;
- apply compaction checkpoints;
- exclude bookkeeping events that the model does not need;
- return new immutable messages rather than exposing mutable journal data.

The existing `Message[]` can remain temporarily as a cache during migration. It should eventually be
a projection, not the source of truth.

### Persistence format

Use one append-only JSONL file per session under `.beecork/sessions/`, with mode `0600`:

```json
{"version":1,"seq":1,"time":"...","type":"session_started","sessionId":"..."}
{"version":1,"seq":2,"time":"...","type":"turn_started","turnId":"...","input":{...}}
```

Why JSONL:

- append is cheap;
- a crash generally damages only the last row;
- events are inspectable with ordinary tools;
- no database dependency is required;
- replay fixtures can use the same format.

Writes should be flushed at externally meaningful boundaries, especially before and after mutating
tools. Atomic whole-file replacement remains suitable for small preferences, but not for recording an
in-progress turn.

### Crash and resume behavior

On load:

1. Validate every row and stop at a malformed trailing row.
2. Enforce contiguous `seq` values and unique call IDs.
3. Find open turns, steps, and tool calls.
4. Never claim an uncertain tool call did not run.
5. Append a recovery event that marks the interrupted turn.
6. Derive a provider-valid transcript from the repaired history.

An incomplete mutating tool call is inherently uncertain after a hard crash. The journal should
report that uncertainty rather than inventing success or failure. If tools later gain idempotency keys
or verifiers, recovery can reconcile them more precisely.

### Migration from existing sessions

Do not invalidate users' saved sessions.

- Continue reading legacy JSON message arrays.
- Sanitize them with the existing trust rules.
- Import them as a `legacy_transcript_imported` seed event or convert each message into seed events.
- Write all new work in the versioned event format.
- Keep the legacy reader for at least one documented compatibility period.

---

## 3. Structured tool execution

### Current limitation

Tool failures are currently communicated as ordinary text whose first word must be `Error`. That
makes correctness depend on presentation wording and prevents the loop from reliably distinguishing:

- user cancellation;
- policy rejection;
- invalid arguments;
- transient failure;
- permanent tool failure;
- partial success;
- successful output that happens to begin with the word “Error”.

### Target contract

```ts
type ToolOutcome =
  | {
      ok: true;
      content: ToolContent[];
      summary?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      ok: false;
      code: "INVALID_ARGS" | "DENIED" | "CANCELLED" | "TIMEOUT" | "FAILED";
      message: string;
      retryable?: boolean;
      metadata?: Record<string, unknown>;
    };

type ToolExecutionMode = "parallel" | "exclusive";

type ToolDef = {
  name: string;
  description: string;
  parameters: object;
  execution: ToolExecutionMode;
  timeoutMs?: number;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
  // Existing approval and mutation policy fields remain.
};
```

The UI converts an outcome to human-readable text. The OpenRouter adapter converts it to model-facing
tool content. The journal stores the structured outcome. None of those layers should infer semantics
from a string prefix.

### Compact lifecycle pipeline

Implement a small fixed pipeline:

```text
parse arguments
→ resolve tool and execution mode
→ evaluate hard safety policy
→ request approval if needed
→ append tool_started
→ execute with timeout and AbortSignal
→ normalize outcome
→ append tool_finished
→ render for model and human
```

This need not be a plugin system. A few pure functions are enough.

### Concurrency and cancellation rules

- Tool declarations, not a central name allowlist, decide parallel versus exclusive execution.
- Parallelism must have a configurable upper bound.
- Exclusive tools are barriers: all earlier parallel calls settle before one starts.
- Tool results are committed to model history in original model-call order.
- Cancellation stops scheduling new calls but waits for already-started calls to settle or time out.
- Calls not started receive a structured cancelled outcome so tool-call pairing remains valid.
- A completed external side effect is journaled even if the overall turn is cancelled.

Preserve beecork's valuable current behavior: verify once after the final edit in a model tool-call
batch, not after every individual edit.

---

## 4. Add a real OS sandbox

### Why approvals and parsing are not confinement

beecork's catastrophic-command denylist, secret guards, path checks, approval prompts, and safe-command
classifier should remain. They express understandable user policy.

They cannot guarantee filesystem confinement for arbitrary shell programs. A permitted command can:

- follow a symlink outside the workspace;
- execute an interpreter that performs different operations;
- access a path assembled at runtime;
- spawn another binary;
- use an application-specific write option the classifier does not understand.

The policy layer answers, “Should this operation be attempted?” An OS sandbox answers, “What is the
process technically capable of doing?” Both are needed.

### Target modes

Use the existing modes as the public contract:

| beecork mode | Sandbox capability |
|---|---|
| read-only / plan | Workspace readable; no workspace writes; tightly limited temporary writes if runtime requires them |
| normal / auto-approve | Workspace and private temp writable; other filesystem locations read-only or inaccessible |
| dangerous bypass | Explicitly broad access, while catastrophic-command refusal remains as documented |

### Platform sequence

1. macOS: Seatbelt profile through `sandbox-exec`, with a functional startup probe.
2. Linux: prefer bubblewrap; evaluate Landlock as a fallback.
3. Windows: design separately around restricted tokens and ACLs rather than pretending POSIX rules
   transfer directly.

The sandbox should fail closed: if the selected runner is unavailable or its probe fails, do not
silently run the command unsandboxed. Give the user a precise diagnostic and an explicit escape hatch.

### Important integration rule

All process-producing features must share one subprocess boundary:

- foreground `run_bash`;
- background tasks;
- future persistent terminals;
- language servers if added;
- any tool that indirectly launches a local process.

Do not add sandbox wrapping independently in each feature.

---

## 5. Deterministic replay and assembled-agent testing

beecork already has two strong test layers:

- focused unit tests;
- real-model evaluations that inspect the world instead of trusting the model's self-report.

The missing middle is a deterministic whole-agent harness.

### Proposed harness

Create a scripted model adapter that emits recorded stream events and tool calls. Run those fixtures
through the same agent runtime, tools, journal, and session persistence used by the product. Mock only
the model/network boundary and nondeterministic clock/IDs.

Each scenario should assert:

1. the final event journal;
2. the derived OpenRouter message sequence;
3. the filesystem or process world;
4. the displayed terminal events at a semantic level;
5. successful replay from the persisted journal.

### Required first scenarios

| Scenario | Regression it must catch |
|---|---|
| Edit succeeds, next request fails | Transcript must not forget a real file mutation |
| Cancellation during parallel reads | Started calls settle; unstarted calls are represented; pairing remains valid |
| Cancellation after an edit | Edit remains recorded and resume sees it |
| Crash between tool start and finish | Resume reports an uncertain interrupted call without corrupting history |
| Two parallel reads finish out of order | Model-visible results retain original call order |
| Approval rejected | Tool never starts; denial is durable and structured |
| Compaction then resume | Derived history is equivalent before and after reload |
| Confirmed context overflow | Context policy changes history and retries exactly once as specified |
| Legacy session import | Existing sanitized sessions remain usable |

Keep stochastic real-model evals. Replay tests complement them; they do not replace them.

---

## 6. Model-aware context management

### What to improve first

The current characters-divided-by-four estimate is useful as an inexpensive fallback. Improve context
handling in this order:

1. Read the selected model's advertised context length from the existing OpenRouter catalog.
2. Reserve enough room for the configured maximum output and reasoning tokens.
3. Track images separately using capability/model metadata where available.
4. Prune or replace old, large tool results before summarizing conversational history.
5. On a provider-confirmed context-overflow error, compact more aggressively and retry under an exact
   one-retry policy.
6. Record the compaction checkpoint and the reason (`pressure`, `manual`, or `context_overflow`) in the
   journal.

### What not to build initially

- A tokenizer for every OpenRouter model.
- Provider-specific compaction implementations.
- Arbitrary regional compaction selected through a UI.
- DeepSeek's full compaction lock and projection framework.

Use exact tokenization when cheaply available, catalog metadata when known, and the current heuristic
as a conservative fallback.

### Compaction correctness invariants

- Never split an assistant tool-call group from its tool results.
- Never summarize raw base64 image data.
- Preserve active user rules and unfinished work.
- Keep a retained recent tail.
- A failed summary leaves the model-visible surface unchanged.
- A successful checkpoint is replayable after restart.
- A retry after overflow cannot loop indefinitely.

---

## 7. Replace globals with an `AgentRuntime`

This is a supporting architectural improvement, not a request for dependency injection everywhere.

```ts
type AgentRuntime = {
  id: string;
  workspace: string;
  model: ModelAdapter;
  journal: EventJournal;
  tools: ToolRegistry;
  approvals: ApprovalPolicy;
  subprocess: SubprocessProvider;
  context: ContextPolicy;
  tasks: BackgroundTaskRegistry;
};
```

Benefits:

- tests can run multiple isolated agents in one process;
- subagents can receive deliberately reduced capabilities;
- MCP connections and background tasks have clear ownership;
- session-specific tools and permissions become possible;
- teardown can wait for all owned activity to reach quiescence;
- future embedding does not share accidental process-global state.

Do not split every field into its own package. Keep the flat `src/` layout until file size or ownership
provides a concrete reason to change it.

---

## 8. Complete decision table: what to borrow

| Area where DeepSeek Harness is stronger | Should beecork have it? | Decision and rationale |
|---|---|---|
| Append-only session events | **Yes, smaller form** | Highest correctness value; required for honest recovery after side effects |
| Transcript derived from events | **Yes** | Prevents persisted execution and model context from disagreeing |
| Explicit turn/step outcomes | **Yes** | Makes cancellation, errors, limits, and evaluation unambiguous |
| Structured tool errors/results | **Yes** | Removes the brittle `Error` string protocol and enables policy/retry logic |
| Declared parallel/exclusive tools | **Yes** | Scales to MCP and future tools better than a central allowlist |
| Bounded tool scheduler | **Yes** | Prevents an unbounded model batch from exhausting resources |
| Cancellation draining and synthetic skipped results | **Yes** | Keeps actual work and tool-call pairing consistent |
| OS-level subprocess sandbox | **Yes** | The most important safety gap; heuristics alone cannot confine programs |
| Provider/model-aware context capacity | **Yes** | OpenRouter already exposes much of the needed metadata |
| Tool-result pruning before summary | **Yes** | Cheap token savings with less information loss than full summarization |
| Context-overflow recovery | **Yes** | Converts a common fatal provider error into a bounded recovery path |
| Deterministic replay snapshots | **Yes** | Covers lifecycle bugs that unit and stochastic eval tests miss |
| Per-agent runtime scope | **Yes** | Needed for clean ownership, testing, and future subagents |
| Lifecycle extension hooks | **A few, later** | Add typed hooks only at demonstrated seams; no general plugin bus yet |
| Durable child-agent identities | **Only if subagents expand** | The current read-only `explore` tool is appropriately simple |
| Writable/continuable multi-provider subagents | **Not now** | Large safety and UX surface without a current product requirement |
| JSONL persistence | **Yes** | Inspectable and sufficient for a local CLI |
| SQLite persistence and query service | **No, not now** | Useful for a platform or large session library, unnecessary for current scope |
| Raw streamed-chunk persistence | **No, initially** | Helpful for exact UI replay but expensive; complete assistant messages are enough now |
| Full plugin framework and reversible hot unload | **No** | Would damage beecork's readability for little present benefit |
| Profile/bundle configuration graph | **No** | Solves distribution and composition needs beecork does not have |
| Web UI | **No by default** | A different product surface, not an agent-quality improvement |
| ACP/JSON-RPC/TypeScript/Python SDKs | **Only on product demand** | Valuable when embedding/automation becomes a goal, otherwise maintenance burden |
| Persistent terminal and LSP services | **Evaluate separately** | Potential user value, but unrelated to loop correctness |
| Schedules, workflows, and goals subsystem | **No, not now** | Moves beecork toward an automation platform rather than a focused CLI |
| Telemetry | **No** | Conflicts with beecork's no-phone-home identity; local diagnostics are sufficient |

---

## 9. Capabilities where beecork should remain different

DeepSeek Harness is not uniformly better. Preserve and continue testing these beecork strengths:

### Safety policy

- DNS-aware SSRF blocking and redirect revalidation.
- Secret-file gates for file tools and safe-shell classification.
- Catastrophic command refusal even under dangerous approval bypass.
- Project-scoped remembered approvals stored outside the repository.
- MCP tools dangerous by default.
- `readOnlyHint` trusted only after explicit server opt-in.
- `destructiveHint` always believed because it only increases friction.
- Project files cannot silently configure executable MCP servers.
- Planted session system messages and remote-image beacons are rejected.

The OS sandbox should reinforce these controls, not replace them.

### Agent and terminal experience

- A compact loop that a contributor can understand end to end.
- Auto-verification once after an edit batch.
- Safe self-healing edits.
- Rich human output through `show` without putting all of it into model context.
- Mid-turn steering.
- Browser console and network feedback from the user's real browser session.
- OpenRouter BYOK and model portability.
- A read-only, non-recursive `explore` subagent with a narrow capability boundary.

### Evaluation philosophy

- Assert the external world, not the agent's claim about what it did.
- Run repeated real-model trials and report variance.
- Keep style judgments separate from objective task completion.

---

## 10. Implementation sequence

Each phase should ship independently. Do not combine the journal, tool rewrite, and sandbox into one
large change.

### Phase 0 — pin current behavior

Before changing architecture:

- Add scripted-loop regression tests around current tool ordering and cancellation.
- Capture current session sanitization, approval, compaction, image, and reasoning-continuity behavior.
- Document durable event invariants in tests.

**Exit condition:** the new tests fail when a successful edit is forgotten after a later error.

### Phase 1 — journal alongside the transcript

- Add `AgentEvent`, `EventJournal`, stable IDs, sequence validation, and JSONL serialization.
- Dual-write events while preserving the current `Message[]` loop.
- Record explicit completed, cancelled, error, and step-limit outcomes.
- Do not change normal model-visible behavior yet.

**Exit condition:** every successful tool action remains present in the journal after cancellation or a
later failure.

### Phase 2 — structured tool outcomes

- Introduce `ToolOutcome` and adapters for legacy string-returning tools.
- Move execution mode onto each `ToolDef`.
- Add a bounded scheduler with exclusive barriers.
- Record approval and execution lifecycle around each tool call.
- Convert UI and model rendering to consume structured outcomes.
- Remove prefix-based error detection after all built-in and MCP tools migrate.

**Exit condition:** no control-flow decision depends on tool result wording.

### Phase 3 — derive history and migrate sessions

- Implement the pure journal-to-messages projection.
- Compare its output against the existing transcript during a temporary shadow period.
- Switch model requests to projected messages.
- Import legacy sessions and write only the versioned journal format for new sessions.
- Add repair behavior for interrupted turns and calls.

**Exit condition:** resume, cancellation, compaction, and normal turns use the journal as their single
source of truth.

### Phase 4 — OS sandbox

- Route every subprocess through one provider.
- Implement and probe macOS confinement first.
- Add Linux support and explicit unsupported-platform behavior.
- Verify read-only, workspace-write, temporary-directory, symlink, child-process, and runner-failure
  cases.

**Exit condition:** an approved workspace-scoped command cannot write outside its allowed roots, and a
broken sandbox runner never silently falls back to unsandboxed execution.

### Phase 5 — context policy and replay suite

- Add model-aware budget calculation and output reserve.
- Add old tool-result pruning.
- Add bounded overflow recovery.
- Journal compaction checkpoints.
- Finish deterministic replay fixtures for all failure boundaries.

**Exit condition:** a saved session deterministically derives the same context before and after restart,
and confirmed overflow has one tested recovery path.

### Phase 6 — runtime ownership

- Introduce `AgentRuntime` and migrate global registries gradually.
- Give parent and explore agents distinct runtime scopes.
- Define runtime disposal and wait for owned tools/processes to settle.

**Exit condition:** two runtimes can execute in one process without sharing approvals, tool registries,
background tasks, or mutable model/session state.

---

## 11. Definition of done

The improvement program is complete when all of these are true:

- A completed tool side effect cannot disappear from execution history because of a later error.
- Every started turn has a durable terminal outcome or a detectable interrupted state.
- Model-visible history is reproducible from persisted data.
- Tool success, failure, denial, timeout, and cancellation are typed values.
- Parallel tool execution is bounded, ordered for the model, and cancellation-safe.
- Shell processes are confined by the OS in ordinary modes.
- Existing secret, SSRF, approval, MCP, and session-trust protections remain intact.
- Context budgeting uses model capacity when known and has a bounded overflow recovery path.
- Keyless replay tests cover partial failure, cancellation, crash recovery, compaction, and resume.
- Existing real-model evaluations continue to verify the resulting world.
- A contributor can still understand the main loop and its surrounding runtime without learning a
  general plugin framework.

---

## Final recommendation

The correct direction is not “make beecork architecturally identical to DeepSeek Harness.” It is:

> Keep beecork's product shape, but stop treating the provider message array as the authoritative
> record of execution.

Build a small durable journal, structured tool lifecycle, and real subprocess confinement. Those
three changes address the deepest correctness and safety gaps. Add deterministic replay and
model-aware context recovery immediately after them because they make the new architecture provable.

Everything else from DeepSeek Harness should remain demand-driven. beecork's size, directness, strong
local-security policy, and terminal ergonomics are strengths to protect—not temporary limitations to
grow out of.
