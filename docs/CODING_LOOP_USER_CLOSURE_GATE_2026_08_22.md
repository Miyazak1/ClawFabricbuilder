# Coding Loop User Closure Gate

Date: 2026-08-22

Status: implemented and packaged/real-provider verified

## User Problem

The coding loop could visibly end on an automatic check row such as `Ran npm test` without a final assistant summary. The draft existed, but the user could not tell whether the task had actually finished or confidently continue with a question such as how to run and use the project.

## Root Cause

The canonical main-process order was already correct:

1. Harness emitted its final model narration.
2. Builder ran automatic checks and bounded repair attempts.
3. Builder materialized the candidate workspace.
4. Main recorded the official `run_completed` item with the assistant summary.

The renderer then applied deduplication in the wrong direction. When the pre-check runtime narration and the official post-check `run_completed` summary had identical text, it hid the official terminal item and retained the earlier narration. The visible stream therefore ended on the check even though the canonical conversation had completed.

## Implemented Contract

- Exact duplicate summaries are still rendered once.
- The earlier runtime narration is hidden when it duplicates the official completion summary.
- The official `run_completed` summary is always rendered at its canonical post-check position.
- Runtime file and command evidence remains visible before the final summary.
- The composer becomes editable after the terminal run.
- A user can switch to Ask and question the current unsaved draft without saving a formal version.
- A read-only usage question must not create another candidate or mutate the current draft.

## Acceptance Journey

The packaged Plan-mode gate now proves this user journey:

1. Submit a Chinese Plan request.
2. Review and approve the Markdown plan.
3. Approve Project write access when required.
4. Execute the approved plan through DeepSeek Harness.
5. Observe an automatic passing project check.
6. Observe one final assistant summary after the last command fact.
7. Confirm the composer is editable again.
8. Ask `这个项目应该怎么运行和使用？` in Ask mode.
9. Receive an answer grounded in the current unsaved source, including `index.html` and `npm test` for the deterministic fixture.
10. Continue editing the same unsaved draft without a mandatory Version save.

The real saved-profile DeepSeek gate additionally proves:

- Chinese narration before tool actions;
- a failed check followed by a model repair and passing check;
- one Chinese final summary after the last command;
- a Chinese usage answer grounded in the current Project files;
- no additional candidate created by the usage question;
- the candidate remains recoverable without a formal save.

## Verification Evidence

- `BuilderPage.test.tsx`: 107 passed.
- Packaged canary contract tests: 90 passed.
- DeepSeek Harness canary contract tests: 13 passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Windows package build and package integrity verification: passed.
- Packaged Plan-mode canary v4: passed with `final_summary_after_check`, `composer_reenabled_after_completion`, and `project_usage_answer_grounded_in_current_draft`.
- Real saved-profile DeepSeek Harness canary v2: passed with failed-then-passed check repair, one Chinese post-command summary, and a grounded Chinese usage answer.

## Residual Risk

One real-provider run before the repair-prompt correction reached a passing
check fact but failed the strict expected-candidate evidence check. The repair
prompt had not restated the original request and did not explicitly forbid
weakening verification. It now preserves the original request and constraints
and fails closed against test weakening. Two consecutive real saved-profile
DeepSeek runs then passed the full v2 gate, including failed-then-passed repair
and unchanged package/check fixtures.

Provider execution remains stochastic. Failed-run candidate and tool
diagnostics should still remain available for bounded inspection, and the UI
should offer a visible retry/continue route without losing the last verified
checkpoint.

## Next Stage

Durable local coding workflow v1 is now accepted in
[Durable Local Coding Workflow V1 Implementation Gate](DURABLE_LOCAL_CODING_WORKFLOW_V1_IMPLEMENTATION_GATE_2026_08_22.md).

The next reliability slice is a structured run/use handoff derived from Project
Understanding, packaged coverage for cross-run compaction-summary disclosure,
and visible failed-run diagnosis/retry. Parallel Task supervision and broader
Agent Workbench expansion can then build on the existing Git, SQLite,
checkpoint, and Conversation authorities rather than replace them.
