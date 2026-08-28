# ClawFabric Builder Documentation

This directory is the product and architecture authority for the standalone
ClawFabric Builder application.

For repository-level contributor and coding-agent rules, start with
[AGENTS.md](../AGENTS.md), especially the dependency readiness rule:
detect existing tools and dependencies before any install request.

## Current Stage Authority

The 2026-08-25 next stage prioritizes a real language-independent programming
loop, an isolated built-in Browser, and measured interaction performance. Read
this set together:

1. [Universal Programming and Browser Loop Roadmap](UNIVERSAL_PROGRAMMING_AND_BROWSER_LOOP_ROADMAP.md)
2. [Universal Programming Runtime Contract](UNIVERSAL_PROGRAMMING_RUNTIME_CONTRACT.md)
3. [General Browser Web Mode Architecture](GENERAL_BROWSER_WEB_MODE_ARCHITECTURE.md)
4. [Harness Runtime Upgrade and Rollback Policy](HARNESS_RUNTIME_UPGRADE_AND_ROLLBACK_POLICY.md)
5. [Universal Programming and Browser Acceptance Matrix](UNIVERSAL_PROGRAMMING_AND_BROWSER_ACCEPTANCE_MATRIX.md)
6. [DeepSeek Harness and Pi Adoption Decisions - 2026-08-25](DEEPSEEK_HARNESS_AND_PI_ADOPTION_DECISIONS_2026_08_25.md)
7. [Builder Chat and Generation Performance Plan](BUILDER_CHAT_GENERATION_PERFORMANCE_PLAN.md)
8. [Builder Current Event and Projection Architecture Audit - 2026-08-25](BUILDER_CURRENT_EVENT_PROJECTION_ARCHITECTURE_AUDIT_2026_08_25.md)
9. [Mature Coding Desktop Architecture Research - 2026-08-25](MATURE_CODING_DESKTOP_ARCHITECTURE_RESEARCH_2026_08_25.md)
10. [Builder Event and Projection Foundation Architecture - 2026-08-25](BUILDER_EVENT_PROJECTION_FOUNDATION_ARCHITECTURE_2026_08_25.md)
11. [Builder A0 Live Delta Refresh Isolation Gate - 2026-08-25](BUILDER_A0_LIVE_DELTA_REFRESH_ISOLATION_GATE_2026_08_25.md)
12. [Builder A0 Packaged Performance Baseline - 2026-08-25](BUILDER_A0_PACKAGED_PERFORMANCE_BASELINE_2026_08_25.md)
13. [Builder A0.3 Incremental Replay and Projection Gate - 2026-08-25](BUILDER_A03_INCREMENTAL_REPLAY_AND_PROJECTION_GATE_2026_08_25.md)
14. [Builder A0.4 Cursor and Renderer Isolation Gate - 2026-08-25](BUILDER_A04_CURSOR_RENDERER_ISOLATION_GATE_2026_08_25.md)
15. [Builder A0.5 Stress Qualification Gate - 2026-08-25](BUILDER_A05_STRESS_QUALIFICATION_GATE_2026_08_25.md)
16. [Builder A0.6 Terminal Settle Attribution Gate - 2026-08-26](BUILDER_A06_TERMINAL_SETTLE_ATTRIBUTION_GATE_2026_08_26.md)
17. [Builder A0.6b Main Cold-Path Attribution Gate - 2026-08-26](BUILDER_A06B_MAIN_COLD_PATH_ATTRIBUTION_GATE_2026_08_26.md)
18. [Builder A0.6c Harness Runtime And JSON-RPC Attribution Gate - 2026-08-26](BUILDER_A06C_HARNESS_RUNTIME_JSONRPC_ATTRIBUTION_GATE_2026_08_26.md)
19. [Builder A0.7 Behavioral Performance Gate - 2026-08-26](BUILDER_A07_BEHAVIORAL_PERFORMANCE_GATE_2026_08_26.md)
20. [Builder Sandbox Settings And Runtime Policy Plan - 2026-08-26](BUILDER_SANDBOX_SETTINGS_AND_RUNTIME_POLICY_PLAN_2026_08_26.md)
21. [Builder Worktree And Workspace Lifecycle Policy - 2026-08-26](BUILDER_WORKTREE_AND_WORKSPACE_LIFECYCLE_POLICY_2026_08_26.md)
22. [Builder Environment Readiness Settings And Diagnostics Plan - 2026-08-27](BUILDER_ENVIRONMENT_READINESS_SETTINGS_AND_DIAGNOSTICS_PLAN_2026_08_27.md)
23. [Builder B1 Performance Cold-Path Attribution - 2026-08-27](BUILDER_B1_PERFORMANCE_COLD_PATH_ATTRIBUTION_2026_08_27.md)
24. [Builder B2 Durable Terminal Settlement Decoupling - 2026-08-27](BUILDER_B2_DURABLE_TERMINAL_SETTLEMENT_DECOUPLING_2026_08_27.md)
25. [Builder B2.1 Terminal Settlement Projection Narrowing - 2026-08-27](BUILDER_B21_TERMINAL_SETTLEMENT_PROJECTION_NARROWING_2026_08_27.md)
26. [Builder B3 Chat Runtime Performance Stabilization - 2026-08-27](BUILDER_B3_CHAT_RUNTIME_PERFORMANCE_STABILIZATION_2026_08_27.md)
27. [Builder B4 Task Stream Payload Budget And Cursor Hardening - 2026-08-27](BUILDER_B4_TASK_STREAM_PAYLOAD_BUDGET_AND_CURSOR_HARDENING_2026_08_27.md)
28. [Builder B5 Packaged Performance Evidence Gate - 2026-08-27](BUILDER_B5_PACKAGED_PERFORMANCE_EVIDENCE_GATE_2026_08_27.md)
29. [Builder B6 Task Stream Projection Byte Accounting - 2026-08-27](BUILDER_B6_TASK_STREAM_PROJECTION_BYTE_ACCOUNTING_2026_08_27.md)
30. [Builder B7 Lifecycle Refresh Coalescing - 2026-08-27](BUILDER_B7_LIFECYCLE_REFRESH_COALESCING_2026_08_27.md)
31. [Builder C1 Browser Preview Policy Boundary - 2026-08-27](BUILDER_C1_BROWSER_PREVIEW_POLICY_BOUNDARY_2026_08_27.md)
32. [Builder D1 Workbench Capability Policy - 2026-08-27](BUILDER_D1_WORKBENCH_CAPABILITY_POLICY_2026_08_27.md)
33. [Lifecycle Hooks Architecture](LIFECYCLE_HOOKS_ARCHITECTURE.md)
34. [Harness Runtime Upgrade And Rollback Policy](HARNESS_RUNTIME_UPGRADE_AND_ROLLBACK_POLICY.md)
35. [Builder H Phase Desktop RC Evidence - 2026-08-28](BUILDER_H_PHASE_DESKTOP_RC_EVIDENCE_2026_08_28.md)

This set owns current delivery order and acceptance gates. Gate `A0` is in
progress: typed live/durable refresh isolation, A0.3 suffix-only replay and
projection, A0.4 cursor delivery and renderer isolation, A0.5 packaged stress
qualification, A0.6 terminal-settle attribution, A0.6b Main cold-path
attribution, A0.6c Harness runtime/JSON-RPC attribution, and B1 cold-path
attribution are accepted in the repository and packaged desktop. B2 now narrows
known-task terminal settlement so it refreshes conversation activity without
forcing a project-tree refresh. B2.1 narrows terminal projection reads by
canceling queued durable changed refreshes when a foreground terminal refresh is
already reading the selected task stream. B3 stabilizes the broader chat runtime
path by preventing pending draft restore probes from racing an in-flight selected
conversation load and by requiring renderer read duration, payload, cursor, and
coalescing metrics. B4 hardens task-stream payload accounting so Main and
renderer trace result-byte metrics reuse plain-data clone accounting instead of
stringifying whole task-stream results on the hot path. B5 makes the packaged
stress canary reject missing or amplified Main task-stream IPC/cursor evidence
before Browser/Preview or runtime policy expansion resumes. B6 removes the
remaining whole-result serialization from Main task-stream projection byte
measurement so trace cost does not become projection cost. B7 drains catalog,
project-tree, and Workbench lifecycle refreshes through one App-owned queue so
save and lifecycle actions do not fan out duplicate reads. C1 introduces a
main-owned Browser/Preview policy consumed by Live Preview WebContents runtime
so embedded browser work stays separate from command sandbox, provider, tool,
filesystem, Git, and SQLite authority. D1 adds the same kind of explicit
capability policy for Workbench so future Node/App/Plugin expansion contributes
normalized messages, review-required actions, and bounded context capsules
without gaining Browser, command, provider, source, Git, or Project storage
authority. A0.7/A1 readiness work keeps dependency readiness separate from
host-machine availability, has landed command approval profile reuse,
dependency preparation closure, and A1.3 detect-before-install guardrails.
Browser I1 now has focused implementation evidence for separate Project
Preview, Agent Test, and User Web sessions, but remains gated on the current
packaged real-model RC documented in
[Builder I1 Agent Browser Gate](BUILDER_I1_AGENT_BROWSER_GATE_2026_08_28.md).

The 2026-08-28 H phase RC requalifies the current packaged desktop across saved
DeepSeek history, addressed Workbench hydration, Project Preview, checkpoint and
restart recovery, search/read-only completion, cancellation, and Version save.
It does not promote Project Preview into the later general User Web or Agent
Browser scope.

## Reading Order

1. [Product Vision and Roadmap](PRODUCT_VISION_AND_ROADMAP.md)
2. [Native Kernel Strategy](NATIVE_KERNEL_STRATEGY.md)
3. [Provider Protocol Adapter Architecture](PROVIDER_PROTOCOL_ADAPTER_ARCHITECTURE.md)
4. [Foundational Coding Loop and Plugin Runtime Roadmap](FOUNDATIONAL_CODING_LOOP_PLUGIN_RUNTIME_ROADMAP.md)
5. [DeepSeek Harness Adoption Audit](DEEPSEEK_HARNESS_ADOPTION_AUDIT.md)
6. [DeepSeek Harness Event Parity Gate - 2026-08-22](DEEPSEEK_HARNESS_EVENT_PARITY_GATE_2026_08_22.md)
7. [DeepSeek Harness Coding Loop Convergence V1 Gate - 2026-08-23](DEEPSEEK_HARNESS_CODING_LOOP_CONVERGENCE_V1_GATE_2026_08_23.md)
8. [Controlled Bash V1 Architecture](CONTROLLED_BASH_V1_ARCHITECTURE.md)
9. [Programming Runtime Timeout and Liveness Policy](PROGRAMMING_RUNTIME_TIMEOUT_AND_LIVENESS_POLICY.md)
10. [Programming Runtime Adapter and Event Protocol](PROGRAMMING_RUNTIME_ADAPTER_EVENT_PROTOCOL.md)
11. [Codex-Like Programming Runtime Architecture](CODEX_LIKE_PROGRAMMING_RUNTIME_ARCHITECTURE.md)
11. [Codex-Like Conversation Flow Architecture](CODEX_LIKE_CONVERSATION_FLOW_ARCHITECTURE.md)
12. [Conversation Visual Streaming and Plan Markdown Spec](CONVERSATION_VISUAL_STREAMING_AND_PLAN_MARKDOWN_SPEC.md)
13. [Agent Companion Product Architecture Index](AGENT_COMPANION_PRODUCT_ARCHITECTURE_INDEX.md)
14. [Conversation Loading, Flicker, and Persistence Audit](CONVERSATION_LOADING_PERSISTENCE_AUDIT.md)
15. [MVP Programming Loop Implementation Spec](MVP_PROGRAMMING_LOOP_IMPLEMENTATION_SPEC.md)
16. [MVP Programming Loop Slice Specs](MVP_PROGRAMMING_LOOP_SLICE_SPECS.md)
17. [Post-MVP Product Expansion Plan](POST_MVP_PRODUCT_EXPANSION_PLAN.md)
18. [Live Preview Browser Architecture](LIVE_PREVIEW_BROWSER_ARCHITECTURE.md)
19. [Side Workspace Architecture](SIDE_WORKSPACE_ARCHITECTURE.md)
20. [General Browser Web Mode Architecture](GENERAL_BROWSER_WEB_MODE_ARCHITECTURE.md)
21. [Builder Sandbox Settings And Runtime Policy Plan - 2026-08-26](BUILDER_SANDBOX_SETTINGS_AND_RUNTIME_POLICY_PLAN_2026_08_26.md)
22. [Builder Worktree And Workspace Lifecycle Policy - 2026-08-26](BUILDER_WORKTREE_AND_WORKSPACE_LIFECYCLE_POLICY_2026_08_26.md)
23. [Working Context State Architecture](WORKING_CONTEXT_STATE_ARCHITECTURE.md)
24. [Frontend Experience and Design System Roadmap](FRONTEND_EXPERIENCE_AND_DESIGN_SYSTEM_ROADMAP.md)
25. [Composer Intent Routing Architecture](COMPOSER_INTENT_ROUTING_ARCHITECTURE.md)
26. [Builder Session and Task Address Architecture](BUILDER_SESSION_TASK_ADDRESS_ARCHITECTURE.md)
27. [Persistent Agent Task Context Architecture](PERSISTENT_AGENT_TASK_CONTEXT_ARCHITECTURE.md)
28. [Packaged Experience Test Matrix](PACKAGED_EXPERIENCE_TEST_MATRIX.md)
29. [Storage Lifecycle Governance](STORAGE_LIFECYCLE_GOVERNANCE.md)
30. [Draft Checkpoint Architecture](DRAFT_CHECKPOINT_ARCHITECTURE.md)
31. [Lifecycle Hooks Architecture](LIFECYCLE_HOOKS_ARCHITECTURE.md)
32. [Work Capsule Architecture](WORK_CAPSULE_ARCHITECTURE.md)
33. [Trusted Work and Collaboration Architecture](TRUSTED_WORK_AND_COLLABORATION_ARCHITECTURE.md)
34. [Builder Conversation and Task Stream MVP](BUILDER_CONVERSATION_TASK_STREAM_MVP.md)
35. [Coding Agent Source Reference Audit](CODING_AGENT_SOURCE_REFERENCE_AUDIT_2026_07_22.md)
36. [Implementation Plan](IMPLEMENTATION_PLAN.md)
37. [Legacy Future Plan Coverage Matrix](LEGACY_FUTURE_PLAN_COVERAGE_MATRIX.md)
38. [Builder Architecture](ARCHITECTURE.md)
39. [Legacy Migration Map](LEGACY_MIGRATION_MAP.md)
40. [Release Evidence - 2026-07-22](RELEASE_EVIDENCE_2026_07_22.md)
41. [Extraction and documentation provenance](../provenance/extraction-manifest.json)

## Authority

- These documents define the future product direction for
  `D:\CODE\clawfabric-builder`.
- Documents in `D:\CODE\ClawFabric v5\docs` remain historical references and
  extraction evidence. They do not authorize dependencies on the old
  application tree or compatibility work.
- `provenance/extraction-manifest.json` records both code extraction evidence and
  the old documents rewritten into this repository's authority. Documentation
  migration creates no runtime, package, import, or data dependency.
- `LEGACY_FUTURE_PLAN_COVERAGE_MATRIX.md` classifies old future-plan document
  families as rewritten, summarized, principles-only, future-candidate, or
  intentionally excluded. It is a coverage map, not a compatibility promise.
- Product capabilities are real only when their implementation, tests, package
  verification, and required canaries pass. A roadmap item is not an execution
  authority by itself.

## Product Language

User-facing surfaces should say `Project`, `Version`, `History`, `Preview`,
`Agent`, `Task`, `Review`, `Space`, and `Share`.

Internal terms such as schema, digest, receipt, adapter, sandbox, and runtime
remain available for engineering evidence and advanced diagnostics, but are not
the ordinary user's primary interface.
