# Agent Plan Single-Pass Output And Resume Feedback RC

Date: 2026-08-31

## Observations

- The reported resumed Task did dispatch into the same native Harness session.
  Read/search calls completed, followed by about 72 seconds of model reasoning
  before an interruption was recorded. No file writes occurred in that interval.
  This evidence does not establish a frozen provider or a successful build.
- Builder could hide current waiting text when all visible narration had already
  moved into durable history. Repeated reasoning status was also deduplicated
  across different model steps, instead of only within a step.
- The reported Agent plan ended with
  `builder_generation_structured_response_invalid`. The adapter automatically
  requested a replacement and reset the displayed first response. Terminal
  failure persisted no assistant text.
- A separately authorized, isolated DeepSeek test using only the specified blog
  request reached plan review on the previous RC. The first diagnostic capture
  failed; the subsequent capture succeeded. Validation metrics were absent, so
  the exact failed rule in the original request is not established. The stored
  DOM snapshot count is not a provider-request count.

## Changes

- Keep explicit waiting text visible after committed narration is removed from
  live output. Restart the fixed, public thinking cue for each new model step;
  private reasoning content remains undisclosed.
- Agent Plan explanations use a single provider request. An invalid or incomplete
  response ends the turn instead of silently rewriting the plan. The ordinary
  answer repair and Project Task structured-plan routes retain their existing
  behavior.
- Remove Markdown heading/list quotas as acceptance criteria. The existing
  1,200-code-point outline floor, detailed planning prompt, JSON schema, text
  bounds, and unsafe-material checks remain. Length is not a semantic guarantee
  of plan quality.
- Retain bounded, safety-validated visible plan text on handled generation
  failure. Label it incomplete, persist it with the failed run, and project it as
  `incomplete_result`, not a successful `run_result`.
- Incomplete output cannot become an approvable plan artifact, cannot suppress
  failure/retry state, and cannot replace the previous completed plan. It survives
  a desktop restart after failure has been recorded.

## Verification

- TypeScript build and focused ESLint: passed.
- 358 frontend tests across BuilderApp, BuilderPage, BuilderComposer, and
  builderConversationSnapshot: passed.
- 225 focused Node tests covering generation, Agent conversation/plan recording,
  workbench recording, kernel safety, and Harness normalization/runtime: passed.
- 9 architecture and Electron security tests: passed.
- `npm run dist` and packaged authority/runtime verification: passed.
- Local-provider packaged plan test: one request for the complete plan, one for
  an incomplete revision, no automatic replacement; prior plan unchanged,
  incomplete body visible after restart, composer failure recovery verified.
- Local-provider packaged resume test: clicked Approve plan, New project, Pause,
  Resume, and Save version. Thinking remained visible after tool completion both
  before and after resume. One user turn, no repeated original instruction,
  actual file edits, passed `npm test`, and saved version verified.
- Local-provider repeated-empty-output test: two bounded requests, no files
  written, no terminal spinner, retry enabled.
- Existing empty-output recovery canary also passed through actual file edits,
  checks, and Save version with seven Harness requests.
- The first resume fixture run used a package-file read where the reused fixture
  required an index-file read. It failed; the corrected fixture passed. This was
  not treated as evidence of a new production runtime defect.

Evidence directories under `release/`:

- `agent-plan-deepseek-before-20260831/`
- `agent-plan-single-pass-20260831/`
- `agent-plan-execute-resume-waiting-20260831/`
- `agent-plan-execute-exhaust-20260831/`
- `agent-plan-execute-recover-20260831/`

## Release And Limits

- Desktop: `release/win-unpacked/ClawFabric Builder.exe`
- Installer: `release/ClawFabric Builder Setup 0.1.0.exe`
- app.asar SHA-256:
  `57FD3A66DE7BB42217A6CED2F20F25E02A36112539AC7FF2407159ADC7A2FAEA`
- Final RC desktop regressions used loopback test services, not additional
  real-provider requests. Original user projects/conversations were not changed.
- No dependency installation or permission expansion was introduced.
- Provider reasoning can still take time. This change fixes truthful feedback,
  not model speed. Already-lost text cannot be reconstructed. Retention here is
  for handled failures, not incremental crash-safe checkpoints of a live plan.
- No commit or push was performed for this fix.
