# Builder Dependency Readiness Closure Gate - 2026-08-25

Date: 2026-08-25

Status: active implementation gate.

Follow-up design input:
[Builder Runtime Readiness And Agent Environment Research](BUILDER_RUNTIME_READINESS_AGENT_ENVIRONMENT_RESEARCH_2026_08_26.md).
That research refines this gate with one important distinction: missing
dependencies in a materialized candidate check workspace do not prove the user's
host machine or project root lacks dependencies.

## Problem

Builder automatic checks run candidate source trees in a temporary workspace.
That workspace intentionally contains generated source files, but it does not
copy `node_modules` and does not install dependencies.

Before this gate, a command that failed because a declared dependency or local
tool binary was missing could be classified as a normal `command_failed`
result. In the DeepSeek Harness candidate path, normal failed checks can enter
repair attempts. For dependency-missing failures this is the wrong closure: the
model cannot repair a missing local install by repeatedly editing source files,
and the UI can remain in a misleading running or waiting state until the repair
budget is exhausted.

## External Design Check

DeepSeek Harness keeps the agent loop focused on call-model, run-tools, repeat.
Its public agent-loop documentation states that concrete loop logic is narrow
and behavior beyond the loop belongs to plugins and extension points. It also
describes unhandled failures as terminal for the current turn unless a recovery
listener explicitly returns a retry decision.

Builder should follow that shape: dependency readiness is a Builder acceptance
and environment fact, not a Harness kernel concern and not a source-code repair
target.

Pi is useful as an interaction reference rather than as a runtime dependency.
Its coding-agent session layer emphasizes a small language-independent session
runtime, queued steering/follow-up input, persistent JSONL session history, and
tree/fork navigation. The relevant lesson for Builder is to keep programming
state explicit and resumable while separating fast UI streaming from durable
facts.

## Decision

Classify check failures caused by missing declared dependencies or missing
project-local tool binaries as `environment_unavailable`.

Do not auto-install dependencies in this path. Installing packages is a
separate user-approved capability because it can write many files, run package
manager hooks, and consume network access.

`environment_unavailable` remains an incomplete check projection, but it is a
completed automatic-check fact. The coding loop can reconcile and close the
current turn with actionable user guidance instead of entering source repair.

## Current Implementation

- `builder-check-run-runner` keeps a bounded diagnostic buffer from stdout and
  stderr.
- On non-zero process exit, the runner inspects package dependency declarations
  and common missing-package or missing-binary diagnostics.
- Missing declared modules, missing declared package binaries, or missing
  binaries in a workspace without `node_modules` become
  `environment_unavailable`.
- Relative or absolute local module misses remain ordinary failed checks.
- User-facing unavailable-environment summaries now mention dependency or
  toolchain preparation before retrying the check.
- `builder-coding-loop-check-coordinator` treats unavailable environments as
  completed check facts with an incomplete projection.

## Acceptance

- A candidate with `package.json` declaring `vite`, no installed dependencies,
  and a command error for missing `vite` records `environment_unavailable`.
- A candidate with a broken local import such as `./src/missing.js` remains
  `failed`.
- Automatic check coordination returns `status: completed` for an unavailable
  environment so the generation path can reconcile and clear busy/live output.
- No install, network, provider, Git save, renderer, or Browser authority is
  added to the check runner.

## Next Gates

- Add a packaged canary where a dependency-backed check in a dependency-empty
  candidate workspace terminates with "prepare dependencies/toolchain" guidance.
- Add a first-class `dependencies_missing` subtype when the public schema can be
  versioned without widening the renderer contract too quickly.
- Add a user-approved dependency install card later, separate from Save/Discard
  and separate from automatic repair.
- Continue the broader architecture work: keep Harness as a replaceable loop
  engine, Pi as an interaction reference, and Builder Main as the authority for
  permissions, project truth, checks, Browser, checkpoints, and versions.
