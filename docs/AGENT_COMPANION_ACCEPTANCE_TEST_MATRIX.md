# Agent Companion Acceptance Test Matrix

Date: 2026-08-18

Status: product acceptance and verification matrix.

Related documents:

- [Agent Companion Product Architecture Index](AGENT_COMPANION_PRODUCT_ARCHITECTURE_INDEX.md)
- [Agent Companion Current Implementation Gap Audit](AGENT_COMPANION_CURRENT_IMPLEMENTATION_GAP_AUDIT.md)
- [Agent Companion Near-Term Execution Slices](AGENT_COMPANION_NEAR_TERM_EXECUTION_SLICES.md)
- [Agent Companion MVP Backlog and Decisions](AGENT_COMPANION_MVP_BACKLOG_AND_DECISIONS.md)
- [Agent Companion Solution Completeness Audit](AGENT_COMPANION_SOLUTION_COMPLETENESS_AUDIT.md)
- [Agent-First Projection and Data Contract](AGENT_FIRST_PROJECTION_AND_DATA_CONTRACT.md)
- [Task Conversation Management Architecture](TASK_CONVERSATION_MANAGEMENT_ARCHITECTURE.md)
- [Agent Project Task UI Migration Plan](AGENT_PROJECT_TASK_UI_MIGRATION_PLAN.md)
- [Task Intent Routing And Plan Mode Spec](TASK_INTENT_ROUTING_AND_PLAN_MODE_SPEC.md)
- [Agent Companion Memory Architecture](AGENT_COMPANION_MEMORY_ARCHITECTURE.md)

## Purpose

This matrix defines how Builder should prove the Agent companion plan works.

The target experience is:

```text
The user collaborates with a persistent Agent friend.
The Agent manages Projects and scoped Task conversations.
Memory persists across Tasks, but Task context stays bounded.
Plans, builds, reviews, permissions, and background work remain auditable.
```

Acceptance must be proven through current-state evidence, not through intent or
UI copy alone.

## Verification Layers

Every major feature should be tested at four layers when applicable.

| Layer | What It Proves |
| --- | --- |
| Product scenario | The user workflow behaves as expected |
| Frontend projection | UI renders stable, accessible, non-flickering state |
| Main-side facts | SQLite/events/contracts record the correct authority |
| Safety boundary | Renderer, provider, memory, permissions, source, and Git boundaries hold |

Not every test needs all layers, but consequential work should not be accepted
with frontend-only evidence.

## P0: Stabilize Current Project Conversation

P0 protects the existing Builder experience before Agent-first UI expands it.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Reopen old project with conversation history | Activity loads from replay instead of staying on `Loading activity...` | task stream read result contains ready/absent state; UI test proves stable rendered content |
| Refresh active project | top bar, sidebar, composer, and timeline do not flash empty | frontend test checks retained projection during `refreshing` |
| Conversation replay unavailable | previous projection remains with stale/error state when available | controller test for `stale` instead of blanking |
| Source files panel with long file | source panel scrolls internally | layout test or Playwright screenshot with scrollable source region |
| Tool evidence row typography | starting/running/completed rows share type scale and spacing | component snapshot/DOM class test |
| Composer ready label | generic `Ready to execute current direction` is hidden by default | BuilderComposer test |

Safety checks:

- renderer does not fabricate conversation recovery;
- loading state cannot grant permission;
- source content is not read for project catalog rows;
- stale replay shows a retry/diagnosis rather than silent success.

## P1: Task Conversation And Plan Routing

P1 turns one visible chat into one focused Task conversation and fixes Plan as a
first-class route.

### Intent Routing

| Input | Context | Expected route |
| --- | --- | --- |
| `帮我做一个静态技术博客实施计划` | workspace selected | Plan |
| `给当前文件夹做一个优化方案` | workspace selected | Plan |
| `写一个 README 重构方案` | workspace selected | Plan |
| `把刚才聊的整理成计划` | existing discussion | Plan or Update brief before Plan, not Build |
| `先别写代码，出个方案` | any | Plan |
| `做一个计划管理页面` | workspace selected | Build |
| `做一个方案展示页` | workspace selected | Build |
| `创建一个学习计划表应用` | workspace selected | Build |
| `继续优化` | current draft or ready brief | Build |
| `继续优化` | no prior task context | Clarify |
| `按刚才方案做` | approved plan exists | Build with write gate |
| `按刚才方案做` | unreviewed plan exists | Plan review prompt |
| `这个方案作废` | current brief/plan exists | Update brief |
| `停一下` | active run | Cancel |
| `补充：别用深色` | active run | Steer or queue follow-up |

Evidence:

- renderer decision tests;
- main route decision tests;
- semantic classifier tests for Plan/Build ambiguity;
- conversation event records final route;
- run context snapshot records matching route and dispatch.

### Plan Output

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Plan request succeeds | Plan markdown appears inline in timeline | UI test renders markdown from plan result |
| Plan reads source context | source read approval appears before source read | plan source read approval service result |
| Plan completed | `run_completed.result_kind = plan` | conversation replay assertion |
| Plan approved | approval recorded, no source mutation yet | plan review event; no revision/candidate |
| Approved Plan executed | build continuation uses approved plan and write gate | approved-plan continuation admission and write approval facts |

Safety checks:

- Plan approval is not write approval;
- Plan result is not saved as project revision;
- source context is read only through approval;
- semantic classifier cannot dispatch tools or mutate source.

### Task Boundary

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| User continues same objective | same Task Address or Task Capsule target | task address binding/read result |
| User says `另外...` | new Task proposed/created | new Task Address or boundary prompt |
| User switches project | project picker or new Project-scoped Task | project id changes with explicit UI |
| User asks parallel work | new background Task row appears in monitor | task monitor projection |
| Ambiguous boundary | small continue/new-task choice | UI test |

Safety checks:

- no hidden task switching;
- active-run input cannot start unrelated work unless explicit parallel request;
- build context cannot cross projects silently.

## P2: Default Builder Agent Projection

P2 cuts over to Agent-first navigation and removes the Project-first product
fallback.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Fresh app start | persisted default Builder Agent is available in projection | Agent bootstrap and sidebar projection tests |
| Existing saved projects | projects appear under default Agent | projection uses project catalog result |
| Existing in-progress workspace | workspace appears under default Agent | workspace catalog projection |
| Missing Agent store | fixed setup failure is shown; no alternate shell appears | bootstrap failure test |
| Select Agent project row | opens current project page | frontend interaction test |
| Select Task row with address | opens Task conversation | Task Address lookup test |
| Invalid development fixture without Task Address | reset/migration is required before it can render as a Task | cutover validation test |

Safety checks:

- Agent projection does not create source/write authority;
- project folder remains permission boundary;
- internal ids are not exposed in row labels;
- Project-first navigation cannot reappear after cutover.

## P3: Agent Settings

P3 exposes Agent identity, role, personality, capabilities, projects, context,
and autonomy as structured settings.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Add Agent | creates Agent profile and versioned definition | Agent definition/version store test |
| Edit personality | creates new Agent version | version diff and store test |
| Connect project | project appears under Agent | project binding projection |
| Remove project binding | Agent no longer recalls project-local context by default | context assembly test |
| Pause Agent | no background work starts; chat may be disabled or read-only | lifecycle record |
| Archive Agent | hidden from default list, recoverable from archive | lifecycle/read test |
| Roll back settings | new version points to older settings | version history test |

Safety checks:

- personality cannot grant tools or permissions;
- settings UI does not write raw prompt as the authority;
- model/provider selection is not Agent identity;
- old tasks remain bound to the Agent version that produced them.

## P4: Memory Fact Store And Context Inspector

P4 makes long-term memory real and inspectable.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Task completion proposes memory | memory proposal appears for review | completion summary and memory proposal record |
| User accepts memory | accepted memory fact becomes recall-eligible | memory store read test |
| User rejects memory | rejected memory is not recalled | context assembly exclusion test |
| User edits memory | supersession is recorded | memory supersession test |
| User deletes memory | tombstone blocks recall and derived indexes purge/rebuild | deletion/index test |
| Agent answers using memory | Context Snapshot records memory id | snapshot assertion |
| Memory conflicts with current user instruction | current instruction wins; conflict is shown | conflict projection test |
| Provider egress with private memory | asks or blocks according to policy | disclosure gate test |

Safety checks:

- raw chat is evidence, not memory;
- recalled memory cannot be re-ingested as new memory;
- untrusted tool/web output cannot promote itself;
- vector/graph indexes are pointers, not authority;
- secrets are never stored in ordinary memory.

## P5: Standing Intents And Parallel Task Monitor

P5 makes long-running online Agent behavior visible and governed.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| Create standing watch | standing intent contract recorded with scope and expiry | store/contract test |
| Watch fires | creates task event or proposal, not hidden action | activity/task event test |
| Watch needs permission | shows needs-review/permission state | Activity/right rail UI test |
| Pause watch | no future triggers run | scheduler/store test |
| Revoke Agent autonomy | standing intents stop or downgrade | autonomy policy test |
| Parallel read-only task | appears in right rail and sidebar status | monitor projection test |
| Parallel mutating task conflict | overlapping file writes blocked/serialized | conflict admission test |
| Background task completes | compact result and review action appear | task monitor + conversation marker test |

Safety checks:

- standing intent cannot exceed autonomy policy;
- memory alone cannot trigger background work;
- background runs are visible and cancellable;
- completed parallel result does not auto-merge into focused Task.

## Cross-Cutting Regression Matrix

| Area | Regression to prevent |
| --- | --- |
| Loading | no blanking of sidebar/top bar/composer during refresh |
| Routing | no renderer/main route mismatch |
| Permissions | no write/build without current Project approval |
| Memory | no hidden uninspectable memory |
| Context | no unrelated Task messages in prompt snapshots |
| Source | no project source in catalog/sidebar unless explicitly read |
| Provider | no private memory/source egress without disclosure policy |
| Review | no Plan/Draft result saved without review gates |
| Identity | no Agent setting change rewriting old tasks |
| Parallelism | no two mutating tasks writing overlapping files silently |

## Manual UX Test Script

This manual script should be repeated before packaged canary release once the
Agent-first shell exists.

1. Open Builder with an existing project that has old conversation history.
2. Confirm the project and activity timeline load without indefinite loading.
3. Ask: `帮我做一个静态技术博客实施计划`.
4. Confirm Plan markdown appears in chat and source read approval appears if
   source context is needed.
5. Approve the Plan and confirm no files change yet.
6. Say: `按这个方案做`.
7. Confirm write permission gate appears before Build.
8. Let Build produce a draft and confirm review controls appear.
9. Save or discard the draft and confirm completion summary/memory proposals.
10. Open Agent sidebar and confirm the Task is under Agent -> Project.
11. Create a second parallel read-only task and confirm it appears in right rail.
12. Try deleting or archiving a memory and confirm it disappears from recall.

## Automated Test Groups

Recommended test groups:

| Group | Coverage |
| --- | --- |
| `builder-composer-intent` | local route rules and explicit mode overrides |
| `builder-semantic-route-classifier` | Plan/Build ambiguity and safe classifier authority |
| `builder-generation-main-service` | main route preservation and Plan/Build dispatch |
| `builder-conversation-replay` | event chain and Task timeline reconstruction |
| `builder-task-stream-projection` | public timeline items and no hidden internals |
| `BuilderPage` | Plan markdown, tool rows, review controls, stable loading |
| future Agent sidebar | persisted Agent bootstrap and Agent-first projection |
| future `builder-agent-memory-store` | memory acceptance, supersession, deletion |
| future `builder-standing-intent-store` | autonomy, triggers, pause/revoke |

## Acceptance Definition

The Agent companion plan should not be considered implementation-ready until:

- every P0/P1 scenario has test coverage or a tracked implementation task;
- Plan/方案 natural-language routing has renderer and main coverage;
- Task Conversation has a defined public view model;
- Agent-first sidebar has a read-only projection plan;
- Agent settings, memory, and autonomy controls have explicit non-goals and
  safety boundaries;
- the cutover plan removes Project-first navigation and defines reset/migration
  handling for development fixtures.

## Bottom Line

The product plan is only strong if it is testable. This matrix turns the Agent
companion idea into concrete acceptance evidence:

```text
stable current Builder
-> reliable Task conversations and Plan routing
-> default Agent projection
-> settings and memory
-> long-running online Agent work
```

That order keeps the product ambitious without making the implementation
ungoverned.
