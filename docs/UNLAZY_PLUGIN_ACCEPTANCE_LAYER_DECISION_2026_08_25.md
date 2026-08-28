# Unlazy Plugin Acceptance Layer Decision

Date: 2026-08-25

Status: proposed architecture decision for Builder task acceptance and
performance-gate evaluation.

Related local documents:

- [Builder Chat And Generation Performance Plan](BUILDER_CHAT_GENERATION_PERFORMANCE_PLAN.md)
- [Universal Programming And Browser Acceptance Matrix](UNIVERSAL_PROGRAMMING_AND_BROWSER_ACCEPTANCE_MATRIX.md)
- [Foundational Coding Loop Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md)
- [DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md)

External source reviewed:

- `https://github.com/Leonxlnx/unlazy`
- `https://raw.githubusercontent.com/Leonxlnx/unlazy/main/SKILL.md`
- `https://raw.githubusercontent.com/Leonxlnx/unlazy/main/references/gates.md`
- `https://raw.githubusercontent.com/Leonxlnx/unlazy/main/references/method.md`
- `https://raw.githubusercontent.com/Leonxlnx/unlazy/main/SECURITY.md`
- `https://raw.githubusercontent.com/Leonxlnx/unlazy/main/LICENSE`

## Decision

Builder should not rewrite the whole Unlazy idea before proving value. The
recommended path is to package Unlazy as a pinned, reviewed, optional
`local_trusted` acceptance plugin, with a thin Builder adapter around it.

The plugin may reuse Unlazy's existing skill text, ledger format, parser,
checker, linter, and reverify behavior. Builder should add only the integration
code required to route checks through Builder permission, evidence, storage, and
UI contracts.

This is not a DeepSeek Harness kernel feature. It is a task acceptance layer
above the runtime:

```text
Builder Task
-> Task Contract / Acceptance Gates
-> DeepSeek Harness Runtime or another execution runtime
-> Builder tool facts, check facts, checkpoints, and receipts
-> Acceptance evidence projection
-> Final response constrained by verified evidence
```

The runtime executes work. The acceptance plugin defines what completion means
and verifies evidence. Keeping those responsibilities separate avoids adding
ledger parsing, shell approval, and reverify work to the streaming hot path.

## Direct Plugin Feasibility

Unlazy can be used directly as a plugin only in a bounded form:

```text
Yes:
  - as a Skill-only plugin for agent discipline;
  - as a local trusted plugin that vendors or pins Unlazy;
  - as a CLI-backed GatePlugin that runs reviewed ledgers;
  - as an evaluation tool for Builder performance gates;
  - as a prototype before native Task Contract storage exists.

No:
  - not as in-process product authority;
  - not as a replacement for Builder SQLite/Git/checkpoint authority;
  - not as a replacement for Builder command approval;
  - not inside provider streaming or runtime-event hot paths;
  - not with repository-authored CHECK commands executed without Builder review.
```

The practical answer is therefore: use Unlazy directly for the checker and
workflow, but wrap it. Do not reimplement its gate checker immediately. Do not
grant it implicit authority either.

## Why This Fits Builder

Builder already has many evidence primitives:

- Conversation event log;
- runtime events and tool facts;
- command/check facts;
- Git candidate and verification receipts;
- automatic draft checkpoints;
- review/save/discard state;
- packaged canary evidence;
- performance trace work in progress.

Those facts prove that work happened. They do not yet form a general,
user-objective ledger that says every independent requirement was accepted,
verified, abandoned, or still blocked.

Unlazy is useful because it provides the missing discipline:

- write acceptance gates before substantial work;
- bind each gate to an observable outcome;
- require executable checks to exit zero and match an expected success marker;
- keep pending or missing evidence visible;
- support reverify instead of trusting stale green evidence;
- make abandonment a handoff, not success;
- split long work into coherent leaves with integration gates.

This complements the DeepSeek Harness rather than duplicating it.

## Current Harness Capability Gap

DeepSeek Harness already has:

- supervised runtime launch;
- normalized assistant, reasoning, tool, command, and status events;
- main-owned runtime event recording;
- a build verification step;
- automatic candidate checks;
- repair after failed checks;
- checkpoint and Git/SQLite receipts;
- system instructions that forbid claiming unobserved verification.

It does not yet have:

- a persistent acceptance ledger per task;
- gate ids mapped to user requirements;
- owner/path/dependency declarations for independent work;
- generic reverify semantics across all accepted claims;
- a final-report guard that reconciles every required gate;
- a plugin-facing contract for external gate runners.

Therefore, Unlazy should fill the task acceptance gap first. Harness should
continue to produce execution evidence.

## Plugin Shape

### Package Form

Use one of two acceptable forms:

1. Pin a specific Unlazy commit and vendor it under a reviewed plugin package.
2. Install from an exact source reference into a Builder-managed plugin cache.

The first product slice should prefer vendoring or an exact pinned commit. The
Unlazy README says to pin an exact commit when immutable installation matters.
This aligns with Builder's existing runtime qualification posture.

The license is MIT, so copying, modifying, and distributing a pinned copy is
allowed when the copyright and license notice are preserved.

### Manifest Kind

The plugin is best classified as:

```text
kind: GatePlugin
trust_level: local_trusted
provided_capabilities:
  - acceptance_ledger.v1
  - gate_lint.v1
  - gate_check.v1
  - gate_reverify.v1
  - gate_evidence_projection.v1
```

It is not a RuntimePlugin, ProviderPlugin, ProjectAuthorityPlugin, or
CheckpointPlugin.

### Adapter API

The Builder adapter should expose narrow operations:

```text
create_ledger(task_id, title, gates)
lint_ledger(ledger_ref)
status_ledger(ledger_ref)
preview_check(gate_ref)
request_check_approval(gate_ref, resolved_oracle)
run_approved_check(gate_ref)
reverify_ledger(ledger_ref)
record_manual_evidence(gate_ref, redacted_evidence)
summarize_ledger(ledger_ref)
```

All command execution must go through Builder's existing command approval and
process supervision policy. The plugin may propose a command; Builder decides
whether it can run.

## Security Boundary

Unlazy's own security model is explicit: `CHECK:` lines are shell code. They
run with the checker's permissions and inherited environment. Approval is not a
sandbox.

Builder must therefore enforce these boundaries:

- inherited ledgers are untrusted data;
- `CHECK:`, `EXPECT:`, and `CWD:` must be displayed before execution;
- called scripts must be inspectable before approval;
- approval must be bound to resolved command, CWD, shell, timeout, platform, and
  environment fingerprint;
- approval records must live outside the project or in Builder's main-owned
  private evidence store;
- successful output must be stored as digest and byte count, not raw logs;
- failure output must be bounded and redacted;
- plugin leases coordinate work only; they are not filesystem isolation;
- no plugin check may receive credentials or broader filesystem authority by
  default.

The plugin can further restrict a check. It cannot turn a Builder denial into
an allow.

## Data Model Mapping

Builder should store acceptance evidence as main-owned facts, not as renderer
state.

```text
builder-task-acceptance-ledger.v1
  ledger_id
  task_id
  task_address_id?
  project_id?
  source_kind: unlazy | builder_native
  source_revision
  created_at_ms
  updated_at_ms
  gates[]
  authority

builder-task-acceptance-gate.v1
  gate_id
  ledger_id
  title
  gate_kind: command | manual | metric | integration
  status: pending | approved | running | passed | failed | abandoned
  owns[]
  check_ref?
  expect_ref?
  evidence_refs[]

builder-task-acceptance-evidence.v1
  evidence_id
  gate_id
  evidence_kind
  started_at_ms
  ended_at_ms
  result
  command_fingerprint?
  output_fingerprint?
  metric_values?
  receipt_refs[]
  redacted_summary
  authority
```

The Unlazy ledger file can remain the human-readable artifact. Builder's
SQLite facts are the product authority for UI, restore, report, and final
response constraints.

## UI Placement

The first UI should be small:

- a collapsed "Acceptance" section in Activity;
- gate counts: pending, running, passed, failed, abandoned;
- explicit "Reverify" action when checks are approved;
- links from gates to related check facts, command receipts, screenshots, or
  performance traces;
- final response warning if required gates are unmet.

Do not render a large ledger on every stream update. Acceptance projection must
not cause the chat or Browser panes to remount.

## Performance Use Case

The Builder performance effort is the ideal first consumer. It needs real
evaluation rather than plausible reasoning.

Initial performance gates:

| Gate | Outcome | Evidence |
| --- | --- | --- |
| `PERF-G1` | Submit-to-local-user-row latency is measured for ask and build | packaged trace summary |
| `PERF-G2` | 100 live deltas do not cause 100 complete task-stream reads | task-stream read counter |
| `PERF-G3` | Conversation append/read/projection p95 is measured by event count | SQLite/projection trace |
| `PERF-G4` | Renderer clone/freeze cost is measured separately from Main read | renderer trace |
| `PERF-G5` | Browser and side workspace do not remount during streaming | UI stability trace |
| `PERF-G6` | Save, review, checkpoint, restore, and undo still pass | existing product gates |

These gates should be created before the optimization slice begins, then
reverified after each major implementation phase.

## Adoption Plan

### Phase 0: Documented External Evaluation

- Keep this decision document as the initial architecture record.
- Pin the exact Unlazy commit used for experiments.
- Run only non-executing status/lint mode on sample ledgers first.
- Produce a sample Builder performance ledger without running commands.

Exit evidence:

- sample ledger parses;
- lint warnings are reviewed;
- no command execution occurred.

### Phase 1: Local Trusted CLI Wrapper

- Vendor or cache the pinned Unlazy source.
- Add a Builder adapter that can invoke status, lint, approved check, and
  reverify.
- Route execution through Builder's command approval.
- Store evidence as Builder facts.

Exit evidence:

- command preview appears before execution;
- approval is required for a new oracle;
- successful output is stored by digest and byte count;
- failed output is bounded;
- unapproved gates cannot run.

### Phase 2: Task Acceptance Integration

- Attach ledgers to Builder tasks.
- Show gate summary in Activity.
- Link gate evidence to runtime/check/checkpoint facts.
- Prevent final completion claims when required gates are unmet unless the
  response explicitly reports a handoff.

Exit evidence:

- a task with unmet gates cannot be reported as fully complete;
- abandoned gates remain non-successful;
- reverify demotes stale evidence;
- renderer restart reloads the same ledger state.

### Phase 3: Native Compatibility Layer

- Keep Unlazy as the reference runner while introducing Builder-native gate
  schemas.
- Support metric and UI gates that Unlazy shell checks cannot express well.
- Decide later whether to keep Unlazy as the default runner, one supported
  runner, or a migration source.

Exit evidence:

- native metric gates and Unlazy command gates can coexist;
- task final report reconciles both sources;
- plugin failure cannot block core Builder recovery.

## Rewrite Decision

Do not rewrite Unlazy now.

Reasons:

- its checker, ledger parser, linting, approval identity, and reverify behavior
  already cover the risky mechanics we need to test;
- a rewrite would delay the performance effort and risk weaker checks;
- Builder's unique work is integration: authority, approval, evidence storage,
  UI projection, and final-report constraints.

Rewrite only if one of these becomes true:

- Unlazy's shell/check model cannot pass Builder security review;
- its ledger format cannot represent required Builder task gates;
- its maintenance or license posture becomes unacceptable;
- product performance requires a native runner after measured plugin trials;
- native metric/UI gates dominate command gates.

## Non-Goals

- No plugin execution on streaming delta.
- No untrusted external plugin loading.
- No replacement of Builder SQLite/Git authority.
- No direct source mutation by the acceptance plugin.
- No automatic approval of repository-authored checks.
- No claim that a passing check equals user acceptance or release acceptance.

## Open Questions

- Should the first plugin store ledger files in the project, user data, or both?
- Should performance gates be command gates, metric gates, or mixed gates?
- What exact UI language distinguishes "verified", "passed check", and
  "accepted by user"?
- Should abandoned gates block save, final response only, or release gates only?
- How much of Unlazy's orchestration and parallel dispatch should be exposed in
  Builder v1?

## Recommendation

Adopt Unlazy directly as a pinned local trusted acceptance plugin for the first
experiment. Do not place it in the DeepSeek Harness runtime kernel. Do not
rewrite its core checker until the plugin trial produces evidence that a native
implementation is necessary.

The first production-shaped use should be the Builder chat/generation
performance program: create measurable performance gates, collect baseline
evidence, apply hot-path optimizations, and reverify before reporting the
optimization complete.
