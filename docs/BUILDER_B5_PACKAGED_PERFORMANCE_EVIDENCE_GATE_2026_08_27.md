# Builder B5 Packaged Performance Evidence Gate

Date: 2026-08-27

Status: first packaged evidence gate after B4.

## Objective

B5 turns the recent B2-B4 performance work into packaged-app evidence. The
stress canary already exercises the two user-visible failure modes we care
about most:

- PB-03: a controlled 60-second streaming response that should not force
  repeated full task-stream refreshes or Side Workspace remounts.
- PB-06: a controlled 10 MiB command-output burst that must stay privately
  retained while only bounded public output reaches the renderer.

B5 adds a Main-side gate that proves the packaged desktop run is still using
bounded task-stream IPC/cursor behavior while those scenarios execute.

## Implemented Change

`verify:packaged-harness-stress` now qualifies a `b5_packaged_evidence` block
from the Main performance trace. The gate requires:

- task-stream reads and IPC reads are recorded;
- projection reads and projection byte metrics are recorded;
- cursor incremental and unchanged reads are observed;
- legacy task-stream changed hints remain bounded to the known compatibility
  bridge count;
- Main IPC result bytes and projection result bytes stay below the plain-data
  payload ceiling.

The canary output includes
`b5_packaged_performance_evidence_verified: true` only after these checks pass.

## Boundaries

- B5 does not change user-facing behavior.
- B5 does not tune the Browser/Preview surface yet; it only verifies that
  Side Workspace is not remounted during streaming and output stress.
- B5 does not change dependency preparation or install behavior.
- B5 does not treat machine speed as the contract. It verifies mechanism
  evidence first, then leaves stricter payload and refresh budgets to B6/B7.
- B5 does not fabricate v2 cursors for project or agent invalidation hints.
  Those hints need either a real conversation head cursor or an independent
  activity invalidation channel before the legacy budget can be lowered to zero.

## Medium-Term Plan

1. B5: packaged evidence gate for task-stream IPC, cursor, and output stress.
2. B6: narrow task-stream projections further where B5 evidence still shows
   large payloads or unnecessary reads.
3. B7: coalesce lifecycle refreshes around save/reopen/terminal settlement so
   project tree, history, and preview do not compete with active chat reads.
4. C1: stabilize Browser/Preview as its own right-sidebar capability with
   independent WebContents, navigation, and dev-server boundaries.
5. D1: expose runtime policy settings for approval, sandbox, network, browser,
   and dependency readiness without promising enforcement that is not present.

## Acceptance

B5 is accepted when:

1. `verify-packaged-harness-stress-canary.cjs` rejects missing or amplified
   Main task-stream IPC/cursor evidence;
2. the packaged stress canary exports `b5_packaged_evidence`;
3. focused source tests cover pass and fail paths for the B5 gate;
4. B5 is indexed in the docs authority list.

## Requalification 2026-08-28

The H phase saved-profile DeepSeek matrix requalified the foreground path with
52 projects, 11 tasks, and 45 Agent history entries. Workbench read p95 was
11.351 ms (maximum 13.685 ms), addressed Task synchronization p95 was 202.873 ms
(maximum 369.392 ms), and Main event-loop maximum was 527.696 ms. See
[Builder H Phase Desktop RC Evidence](BUILDER_H_PHASE_DESKTOP_RC_EVIDENCE_2026_08_28.md).
