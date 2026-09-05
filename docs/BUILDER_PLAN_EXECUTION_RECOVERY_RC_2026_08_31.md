# Plan Execution Recovery RC - 2026-08-31

## Incident

After Agent plan approval and project creation, a task produced reasoning only,
then displayed a generation error together with a spinning finishing status and
a Paused sidebar label. The observed model turn used 8192 output tokens without
visible text or a file tool call. The approved plan was present in the admitted
Harness input; this was not a missing-plan handoff.

Builder already attempted one bounded continuation after an empty max-token
turn. That transition raced the SDK's trailing session-idle notification.
Both entered asynchronous conversation persistence with overlapping mutable
state, causing conversation/journal conflicts. Recovery never reached a second
provider request, and terminal recording could fail as well.

## Change

`electron/builder-harness-runtime-event-normalizer.cjs` now orders complete
lifecycle transitions through one promise chain: start, SDK notification,
repair, failure, and completion. Ordering includes the awaited event sink and
the subsequent state mutation. A rejected transition does not poison the queue,
so failure finalization can still execute.

No provider settings, token limits, permission gates, plan content, or user
task records were changed. The existing one-continuation limit remains intact.

## Verification

- New controlled regression failed before the fix: two event sink calls were
  simultaneously active during repair and the trailing SDK idle notification.
  It passes after the fix with exactly one active sink call and a completed run.
- 46 Harness normalizer/runtime/host/session-resume tests passed.
- 190 generation service/runner/conversation/task-monitor tests passed.
- Focused ESLint, TypeScript build, Vite build, Windows packaging, and packaged
  runtime identity/security verification passed. The existing large-bundle
  warning remains.
- Packaged desktop tests use fresh isolated profiles and a loopback SSE
  provider with the real bundled Harness SDK. They do not call external
  DeepSeek or modify the user's original profile/project.

Reproduction and recovery:

```powershell
node scripts/verify-packaged-agent-plan-repair.cjs "release/win-unpacked/ClawFabric Builder.exe" --execute
```

Before the fix this reproduced the reported UI exactly with one Harness
request and conversation/journal conflicts. After the fix the test approves
the complete plan, clicks New project, encounters synthetic reasoning-only
token exhaustion, continues with the approved plan, writes project files,
passes npm test, and clicks Save version. No duplicate user turn is created.

Bounded failure:

```powershell
node scripts/verify-packaged-agent-plan-repair.cjs "release/win-unpacked/ClawFabric Builder.exe" --execute --exhaust
```

Two consecutive empty max-token responses produce a terminal Needs attention
state, no runtime spinner, an enabled Retry button, and no source-file writes.
The original plan repair success/failure canary also passes without flags.

## Evidence And Artifact

- `release/agent-plan-execute-recover-20260831/result.json`
- `release/agent-plan-execute-recover-20260831/execution-result.png`
- `release/agent-plan-execute-recover-20260831/failure.png` (pre-fix reproduction)
- `release/agent-plan-execute-recover-20260831/generation-debug.jsonl` (pre-fix)
- `release/agent-plan-execute-exhaust-20260831/result.json`
- `release/agent-plan-execute-exhaust-20260831/execution-result.png`
- `release/agent-plan-repair-20260831/result.json`
- RC executable: `release/win-unpacked/ClawFabric Builder.exe`
- Installer: `release/ClawFabric Builder Setup 0.1.0.exe`
- `app.asar` SHA-256:
  `C6C8DA0332BABA32BC98B83BEEBC0A95CC40562EC9C0B1165AFE93403FC3A9F1`

The currently open desktop process is not hot-patched. Restart into this RC
before retrying or resuming the original task. External model quality and
future output exhaustion are not guaranteed by these deterministic tests.
