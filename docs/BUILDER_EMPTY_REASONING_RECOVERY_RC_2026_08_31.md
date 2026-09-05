# Empty Reasoning Recovery RC - 2026-08-31

## Observed Failure

The user reported an approved Agent plan creating a task named after its first
section, then remaining in Thinking. Read-only inspection of run
`builder-run:f475d7e7-d322-4551-a3a7-f6d08ee5585c` established:

- The full approved version 5 plan (3825 characters) reached the Harness input.
  The short first bubble was not evidence of a missing implementation plan.
- The first model turn used 8191 output tokens, all reported as reasoning, with
  no visible answer and no tool calls. It ended with `max-tokens` after about
  77 seconds.
- Builder continued once with the same high-thinking configuration. The second
  turn again produced reasoning without tool calls before the run was interrupted.
- Main recorded an interrupted terminal state at 2026-08-31T10:22:22.192Z.
  This was not a successful build or simply a stale spinner.

No raw reasoning, credentials, or user plan text is included in this record.

## Changes

- Keep the initial model request and ordinary task resume behavior unchanged.
- Only a Build settlement with `max-tokens`, no assistant text, and zero tool
  calls can use the existing single recovery allowance.
- Route that recovery through Main's dedicated `session/recover-empty-output`
  method. The Builder SDK adapter uses the public Harness `agent/request`
  waterfall to set `reasoningEffort: off` for that selected session's recovery
  turn. Its wire request uses `thinking.type: disabled` and omits
  `reasoning_effort`.
- Keep provider, model, output cap, workspace, allowed tools, permission gates,
  full approved plan, cancellation and emergency limits unchanged. There is no
  new renderer setting or model-accessible authority.
- Refuse a second recovery, cross-session recovery, or recovery before an
  existing session. Regular followups clear the recovery override; shutdown
  disables it. A second empty output-limit response fails explicitly.
- Agent Plan handoff no longer treats the first Markdown heading as the task
  instruction. It names the approved version, requires reading the bound full
  plan, and includes a bounded, labelled excerpt of the exact source request.
  Missing or mismatched source conversation data falls back to the explicit
  plan execution instruction, not another conversation's text.
- Existing user task history, stored plans, settings and project files were not
  rewritten or retried during this fix.

The pinned Harness adapter supports `off`, `high`, and `max`, not `low`. This
change uses its supported public API, with no vendor archive edits. The wire
meaning of disabled thinking is documented in the official
[DeepSeek thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/).

## Verification

- TypeScript project check and production build: passed.
- Focused ESLint on changed runtime, protocol, tests and canary files: passed.
- Focused Node tests: 228 passed, including Main composition, protocol,
  cancellation, plan binding, terminal projection and security boundaries.
- Focused frontend tests: 235 passed across BuilderPage, BuilderComposer,
  AgentWorkbenchController and BuilderProjectController.
- Windows package integrity, bundled Harness identity and production CSP:
  passed.
- Packaged empty-output recovery: seven local model requests; first request
  high-thinking, all recovery requests non-thinking; complete approved plan and
  8192 output cap retained. Actual fixture files were written, the check passed,
  and Save version was clicked. One user task message only.
- Packaged repeated-empty-output failure: exactly two requests, no project
  writes, no terminal spinner, and Retry enabled.
- Packaged ordinary pause/resume: Pause and Resume clicked, nine local model
  requests, high-thinking preserved throughout, no duplicate user message,
  then a passing check and Save version clicked.
- Packaged Agent Plan: complete plan review, failed revision retention and
  restart retention passed; no automatic full-plan rewrite.

The first packaged recovery attempt caught a missing Main-composition method
forwarder. It was fixed and covered by a new composition test before the above
successful runs. The pause/resume canary also now waits for the previous
narration's React commit before asserting the next step's waiting-only state.

Evidence:

- `release/agent-plan-execute-recover-20260831/result.json`
- `release/agent-plan-execute-exhaust-20260831/result.json`
- `release/agent-plan-execute-resume-waiting-20260831/result.json`
- `release/agent-plan-single-pass-20260831/result.json`

All packaged canaries used the real bundled Harness against a local scripted
provider in isolated temporary profiles. These prove integration and bounded
recovery, not the success or latency of a real model on the user's 3D-blog plan.
No new external-provider request was made in this fix; fresh scoped permission
was requested for a real-provider canary and was not yet received.

## Artifacts

- App: `release/win-unpacked/ClawFabric Builder.exe`
- Installer: `release/ClawFabric Builder Setup 0.1.0.exe`
- `app.asar` SHA-256:
  `87E25E0735DD308D543115C612A8848313F45310C3DAA042422ADE9EF07C363C`

The new behavior requires launching the updated app. Already-created task
bubbles are not renamed, and an existing task is not automatically restarted.
The initial high-thinking request can still take time; this fix prevents an
identical high-thinking retry from consuming the recovery allowance without
implementation. It does not promise a shorter initial reasoning phase.
