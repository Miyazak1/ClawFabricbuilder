# Packaged Experience Test Matrix

This matrix is the current user-experience gate for the MVP Programming Loop.
It groups existing packaged canaries around ordinary ways a user tries Builder,
instead of treating each low-level runtime as a separate product story.

## Command

```text
npm run verify:packaged-experience
```

The command expects the current packaged app at
`release/win-unpacked/ClawFabric Builder.exe`. It does not build a new package.
Run `npm run verify:release` first when source has changed and a fresh package is
needed.

## Coverage

| User path | Evidence |
| --- | --- |
| Auto: ordinary question stays read-only and does not create a draft | `verify:packaged-plan-mode` checks the route, dispatch, and absence of a semantic classifier request for a plain project question. |
| Auto: obvious artifact creation routes to Build without spending semantic classification | `verify:packaged-plan-mode` checks the route, write approval request, and deterministic `clear_build` signal for `做一个计划管理页面`. |
| Ask mode: persistent read-only mode overrides build-like wording | `verify:packaged-plan-mode` checks Ask mode remains active until cleared and skips semantic classification. |
| Build mode: persistent write-intent mode requests write approval even for question-like wording | `verify:packaged-plan-mode` checks Build mode remains active until cleared and asks for current-project write approval. |
| Natural-language Plan: whole-sentence plan/build conflict uses the semantic classifier | `verify:packaged-plan-mode` checks a semantic classifier request, Plan route evidence, plan source-read approval, and reject without source mutation. |
| Explicit Plan mode: one-shot Plan chip proposes a plan and clears before execution | `verify:packaged-plan-mode` checks the chip path, plan proposal, source-read approval, and review actions. |
| Approved Plan continuation: approving a plan starts Build instead of stopping at approval | `verify:packaged-plan-mode` approves the plan, handles write approval, observes provider code-change work, and reaches an unsaved draft. |
| Draft continuation: `继续优化` works before Save Version | `verify:packaged-plan-mode` continues the current unsaved draft, observes a new code-change request, keeps Save Version explicit, and does not require saving first. |
| Default programming loop: generate, automatic check, review, save, restart recovery | `verify:packaged-canary` covers the full default packaged loop, including hidden manual check controls, status-only review evidence, draft commands in the workspace toolbar, and restart recovery. |
| Active-run follow-up: second input is queued rather than silently swallowed | `verify:packaged-active-followup` pauses a real packaged Build, submits a second instruction through the live Composer, verifies the queued UI and durable queue record, then releases the first run and verifies automatic continuation plus the consumed record. |
| Side workspace: Preview, Review/Changes, Files, and restart-safe artifact preview | `verify:packaged-canary` proves that review evidence stays in chat, draft commands stay in the workspace toolbar, and preview/diff surfaces remain separate; file viewer polish is covered by focused source and package tests. |
| Browser Preview: JavaScript, canvas, WebGL, reload, stop, blocked external access, restart cleanup | `verify:packaged-live-preview` covers the independent Live Preview canary. |

## Current Boundaries

- This matrix is a user-experience gate, not a release build gate.
- `verify:release` remains the main release gate and intentionally does not run
  `verify:packaged-live-preview` yet.
- If Browser/Live Preview behavior changes, run both `verify:release` and
  `verify:packaged-live-preview`, or run `verify:packaged-experience` after a
  fresh `verify:release`.
- If composer routing, Plan mode, Ask/Build mode, active-run input, automatic
  checks, review evidence, workspace draft actions, or draft continuation changes, update this matrix and
  the corresponding canary before claiming the packaged experience is covered.
