# Agent Plan Repair RC - 2026-08-31

## Report and cause

Agent Workbench Plan mode could report that AI was not configured even with a
configured provider. The first response could be incomplete, requiring the
existing single repair attempt. That attempt sends four messages: system
instruction, context, repair instruction, and the current user instruction.
The OpenAI-compatible transport accepted only two or three messages. Its local
request-validation failure was then mapped to provider-unavailable.

## Fix

- Accept two to four messages with exactly one leading system message and only
  user messages afterward. Preserve the existing property, role, and total
  prompt-byte checks, and reject fifth messages.
- Map invalid transport requests to `builder_generation_request_invalid`;
  missing configuration and secret resolution still report provider-unavailable.
- Preserve plan completeness validation, one bounded repair, live output reset,
  and the final current-user reminder. No provider settings or execution
  permissions are changed.

## Verification

The new Host Adapter tests use the actual transport with an injected fetch
response, covering streaming and non-streaming repair success and exhaustion.
Before the fix, all four cases reproduced the false configuration error.

- 208 focused Node tests passed across transport, Host Adapter, generation
  kernel/service/IPC, Agent conversation, and Agent plan services.
- 144 Vitest tests passed in BuilderPage and Agent Workbench controller.
- TypeScript/Vite build and packaged integrity verification passed.
- `node scripts/verify-packaged-agent-plan-repair.cjs` passed using the packaged
  Electron app, a fresh temporary profile, and a loopback-only test provider.
  It submitted one Agent Plan request, observed live Markdown, forced a short
  first answer, and verified the full repaired plan and enabled review controls.
  A subsequent unsuccessful revision preserved the previous plan, restored the
  composer, and did not display Check AI settings. Message counts were
  `[3, 4, 3, 4]`. The test did not access the user's profile or real AI credentials.

This RC verifies the local repair protocol deterministically, not the quality
or availability of a live external provider.

## Artifacts

- Desktop: `release/win-unpacked/ClawFabric Builder.exe`
- Installer: `release/ClawFabric Builder Setup 0.1.0.exe`
- Results: `release/agent-plan-repair-20260831/result.json`
- Screenshots: `release/agent-plan-repair-20260831/plan-repaired.png` and
  `release/agent-plan-repair-20260831/incomplete-plan-error.png`
- App ASAR SHA-256:
  `6AC1D54C7CEC7DAAFA988BBB8AD169DE82E5571F801D40670B7EC8A4CD1F6A1C`

An already running desktop process must be restarted to load the updated Main
code. Existing conversation history and provider settings need not be reset.
