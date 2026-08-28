# Conversation Loading, Flicker, and Persistence Audit

## Implementation Update - 2026-08-20

The first old-session recovery fallback is now implemented:

- `read_stream` still treats SQLite replay as the canonical authority;
- when `load_conversation` fails, main records a `conversation_load` diagnostic and may read the latest JSONL transcript archive;
- transcript fallback is projected as `source: sqlite_derived_public_transcript` with `recovery_kind: transcript_restored`;
- restored transcript items render as regular user/assistant chat messages through `transcript_message`;
- transcript-restored conversations show a visible read-only status: `Showing saved transcript. Live activity is unavailable.`;
- restored transcript authority is explicitly `sqlite_derived_public_transcript_restore`;
- fallback cannot expose review/check/agent activity projections and cannot drive permissions, draft restore, save/review, provider dispatch, source reads, source writes, or Git mutation.

Implementation evidence:

- `electron/builder-conversation-main-service.cjs`
- `electron/builder-task-stream-projection.cjs`
- `src/features/builder/domain/builderConversationSnapshot.ts`
- `src/features/builder/presentation/BuilderPage.tsx`
- `tests/builder-conversation-main-service.test.cjs`
- `tests/builder-task-stream-projection.test.cjs`
- `src/features/builder/domain/builderConversationSnapshot.test.ts`
- `src/features/builder/presentation/BuilderPage.test.tsx`

Archive integrity closure (2026-08-20): the incremental JSONL writer now
cross-checks the public conversation export against the existing main-only
compaction projection before recording `event_id` and `event_digest`. Those
internal integrity fields remain checkpoint metadata; they are not added to
the user-facing conversation export. Focused tests prove incremental append,
repair after archive deletion, and rejection of corrupted archives.

Still pending:

- finer `replay_failed` / migration diagnostics;
- full-shell anti-flicker tests covering top bar, side workspace, and composer;
- old projects that have no JSONL transcript archive still need either migration repair or an `absent`/diagnostic state;
- context compaction is stored and restart-readable, and a summary body that
  passed the compaction-summary contract can now join generation provider-context
  assembly as a `compaction_summary` candidate segment. It still does not bypass
  disclosure/egress: when context disclosure is denied, the provider prompt
  receives no compaction-summary payload. Store/projection tests now cover
  restart-readable latest replay, sibling task isolation, and delayed
  older-window supersession. The packaged DeepSeek Harness compaction canary now
  covers active-run token-pressure replacement and continuation, but packaged
  coverage for the separate cross-run `compaction_summary` disclosure journey
  and long-session scale remain pending.

## Implementation Update - 2026-08-13

The P0/P1 implementation is now in place:

- repeated same-project reads retain the last verified conversation while refreshing;
- pending-draft recovery uses a background `probe` and no longer publishes visible loading on every retry;
- opening another project retains the last verified project toolbar and side workspace until the new project is ready;
- a project with no conversation reaches a stable `absent` state instead of indefinite loading;
- packaged canary evidence now requires restart recovery to leave `loading` / `refreshing`;
- every successful SQLite conversation append best-effort records a redacted incremental JSONL checkpoint;
- transcript write failure never rolls back or blocks the authoritative SQLite append;
- a deleted transcript can be rebuilt from a verified SQLite `conversation_loaded` result.

The JSONL archive is implemented as a main-only, non-authoritative recovery source. As of 2026-08-20, `read_stream` can expose a minimal read-only restored transcript when SQLite `load_conversation` fails and a verified archive exists, and the activity panel labels that state visibly. Detailed `replay_failed` / migration diagnostic split remains pending. Transcript data must not drive draft restoration, permissions, review, save, provider dispatch, or any source mutation.

Implementation files:

- `electron/builder-conversation-transcript-archive.cjs`
- `electron/builder-conversation-export.cjs`
- `electron/builder-conversation-main-service.cjs`
- `src/features/builder/application/builderConversationController.ts`
- `src/features/builder/application/builderProjectController.ts`
- `src/app/BuilderApp.tsx`
- `src/features/builder/presentation/BuilderPage.tsx`

## 背景

用户在打包桌面版里观察到两个关联问题：

- 旧会话重新打开后，中间聊天区长时间停在 `Loading activity...`，但右侧 `Versions` 可以正常显示保存历史。
- 打开/加载过程中不只聊天区闪烁，顶部栏按钮、右侧 workspace 面板和部分状态按钮也会闪烁或短暂重建。

这不是单纯的视觉样式问题。当前实现里，项目版本、会话活动、草稿恢复、检查状态、右侧 workspace 文件树和顶部 toolbar 控件分别来自不同的状态源；打开项目时这些状态源异步到达，导致 UI 在多个中间态之间跳动。

## 当前会话如何保存

当前 Builder 的会话不是保存在 renderer、localStorage 或普通文本文件里。权威数据在 Electron main 进程管理的 SQLite 数据库中。

核心表：

- `conversations`
  - 保存会话头。
  - 主键为 `(project_id, conversation_id)`。
  - 记录当前 head：`current_event_sequence`、`current_event_id`、`current_event_digest`。
- `conversation_events`
  - 保存 append-only 事件链。
  - 每条事件有 `sequence`、`event_id`、`event_digest`、`previous_event_*`、`event_type`、`record_json`。
  - 事件包括用户消息、run started/completed、Plan、Draft candidate、review、save/reject、tool activity、progress 等。

当前读写链路：

1. 运行时调用 conversation main service，例如 `begin_question`、`begin_work`、`complete_plan`、`complete_candidate`、`review_plan`、`accept_candidate`、`reject_candidate`。
2. main service 通过 `append_conversation_events(...)` 写入 SQLite。
3. 前端不直接读取 SQLite，而是调用 `taskStream.read({ project_id })`。
4. main service 根据 `project_id` 推导 canonical `conversation_id`：

   ```text
   builder-conversation:<project uuid>
   ```

5. main service 读取 `conversation_events`，用 replay 重建会话状态。
6. `builder-task-stream-projection.cjs` 将内部事件链投影为 renderer-safe activity snapshot。
7. React 页面把该 snapshot 渲染成聊天流、Plan、状态、review checkpoint 等 UI。

长会话压缩是相邻但不同的保存链路：

1. SQLite append 成功后，main 可以 best-effort 派生一个 bounded
   Context Compaction Summary。
2. Summary 存在独立 SQLite store 中，并按 conversation/task address 读取最新记录。
3. Working Context State 只把最新 summary ref 合并进状态，不让它改变
   readiness 或权限。
4. 当前 generation snapshot 可以把已经通过 compaction-summary 合约校验的
   summary body 作为 `compaction_summary` candidate segment 交给 provider
   context assembly。
5. 这仍然不会绕过 disclosure/egress gate：未授权时 provider prompt 不会收到
   summary 正文。
6. Store/projection 测试现在覆盖 restart-readable latest replay、同会话 sibling
   task 隔离，以及延迟写入的旧窗口不会覆盖更完整的新窗口；剩余闭环是长会话
   scale 和打包 canary 覆盖。

关键文件：

- `electron/builder-conversation-main-service.cjs`
- `electron/builder-product-metadata-database.cjs`
- `electron/builder-product-metadata-schema.cjs`
- `electron/builder-task-stream-projection.cjs`
- `src/features/builder/application/builderConversationController.ts`
- `src/app/BuilderApp.tsx`
- `src/features/builder/presentation/BuilderPage.tsx`

## 为什么 Versions 能显示但聊天加载不出来

`Versions` 和聊天活动不是同一条读模型。

- `Versions` 依赖 project revision/history。
- 聊天活动依赖 `conversations` / `conversation_events` 的 replay。

因此可能出现：

- 项目版本存在，右侧 `Versions` 正常。
- 对应 `conversation_events` 不存在、迁移缺失、replay 失败，或者 `project_id -> conversation_id` 对不上。
- 前端只能拿到 history，但拿不到 task stream，于是中间聊天区显示 loading、absent 或 unavailable。

这和 OpenCode 社区里出现过的一类问题相似：底层 SQLite 中旧 message/part 数据还在，但新版本 reader 改为读取新的 session_message/session_context 表后，历史会话打开为空。区别在于我们现在是 project revision/history 与 conversation event chain 分离，读模型分叉更明显。

## 观察到的闪烁链路

### 1. 打开项目时同步清空过多 UI 状态

`BuilderApp.resetWorkspace(nextProjectId)` 当前会递增 `workspaceEpoch`，并同步清空一批状态：

- pending build/approval refs
- plan review state
- submitted/live output
- active file
- current project write approval
- side workspace file tree/content indirectly失效
- check run discovery 状态
- current view 重置为 `project`

随后 `project controller`、`conversation controller`、`history controller`、`side workspace files`、`check run discovery` 再各自异步加载回来。

结果是 UI 会经历：

```text
old stable project
-> reset/loading project
-> saved project ready but activity loading
-> history ready but side workspace/loading
-> activity ready or unavailable
```

顶部栏按钮依赖 `saved/draft/history/artifactTabs/openLocationProjectId/hasUnsavedDraft` 等派生值，所以它也会随着这些中间态卸载、禁用、重建或切换文案。

### 2. conversation controller 的 load 模式会清空当前 activity

`builderConversationController.run(projectId, "load")` 在普通 load 时不会保留已有 conversation。只有 `refresh` 且同 project、已有 conversation 时才进入 `refreshing` 并保留内容。

这意味着打开项目或重复调用 `conversation.load(projectId)` 时，页面容易被置为：

```text
status = loading
conversation = null
```

`BuilderPage.activityMessage()` 会把它显示成：

```text
Loading activity...
```

如果 load 被重复触发，聊天区就会反复回到 loading 空卡。

### 3. pending draft restore 会主动重试 activity load

为了支持重启后从 activity 恢复 pending draft，`BuilderApp.restorePendingDraftFromActivity(...)` 会在若干条件下反复调用：

```text
conversation.load(visibleProjectId)
```

如果 task stream 暂时不可用、旧数据 absent、或 activity 中没有可恢复 draft，它会延迟后重试。当前最大尝试数较高，且这些重试会走可见 conversation controller，所以会制造可见 loading 抖动。

这解释了用户看到的“不是只有聊天区域闪，顶部也闪”：activity restore、project snapshot、history snapshot 和 side workspace 派生状态一起变化。

### 4. 右侧 workspace 与顶部 tab 也依赖当前 project identity

右侧 Browser/Source/Versions/Files tab 的可见性和 active tab 会随 `artifactPanelIdentity`、`showVersionHistoryPanel`、`showFilesPanel`、`showResultFlow`、`showPermissionsPanel` 重新计算。

如果打开项目时先拿到 saved project，再拿到 history，再拿到 activity/review/check 状态，tab 组可能会从空态到 `Versions`，再到 `Source/Browser/Permissions`，造成顶部工具栏和右侧 tab strip 闪烁。

## 问题分类

### P0: 旧会话 activity 恢复不稳定

症状：

- `Versions` 可见，但聊天记录加载不出来。
- 中间区停在 `Loading activity...` 或空白。

可能根因：

- 旧项目没有 `conversation_events`。
- 旧项目只有 revision/history，没有 canonical conversation row。
- `conversation_id` 由 project UUID 推导，但历史数据不是这个形态。
- replay 或 projection fail closed。
- pending restore 重试不断将 visible snapshot 打回 loading。

### P0: 加载时全局 UI 闪烁

症状：

- 聊天区 loading。
- 顶部按钮、workspace controls、右侧 tab 一起闪。

可能根因：

- `resetWorkspace` 同步清空稳定 UI。
- load/refresh 没有区分 foreground visible loading 与 background probe。
- 多个 controller 独立发布 snapshot，没有 last-stable snapshot 合并层。

### P1: transcript 级兜底仍未完整收口

症状：

- SQLite history/revision 可恢复，但聊天 replay 失败时没有可读 fallback。

当前状态：

- 独立 JSONL transcript archive 已存在。
- SQLite 成功 append 后会 best-effort 写入归档，归档失败不影响 SQLite 权威写入。
- 已有从 SQLite `conversation_loaded` 重建/修复 transcript 的 archive repair 能力。
- 已有 `read_stream` -> transcript archive -> `transcript_message` 的只读展示 fallback。

剩余缺口：

- UI 已经提示这是从保存 transcript 恢复的只读聊天记录。
- fallback 只覆盖已归档公开消息；没有 archive 的旧项目仍只能走 absent/unavailable 或未来迁移修复。
- 还未区分 `archive_absent`、`replay_failed`、`schema_migration_required` 等更细诊断。
- full-shell loading/flicker 仍需单独治理。

## 与主流产品对比

### Codex / Claude Code / Pi：本地 JSONL transcript

常见形态：

- 每个 session 一个 `.jsonl` 文件。
- 每一行是用户消息、assistant 消息、tool call、tool result、metadata 或 system event。
- resume 时直接读取该文件并重建聊天。
- Claude Code 默认将 session 存在 `~/.claude/projects/.../<session-id>.jsonl`。
- Pi 将 session 存成 JSONL，并通过 `id/parentId` 支持树状分支。
- Codex 公开讨论和 issue 中也体现了本地 rollout/session JSONL 文件与 resume/fork 的模式。

优点：

- append-only，写入简单。
- 人类可以检查和导出。
- 迁移失败时仍有原始 transcript 可读。
- 适合 resume、export、diagnostics。

缺点：

- 查询弱。
- 复杂权限、revision、draft restore、tool admission 不适合只靠文件驱动。
- 大 session、fork、compaction 需要额外设计。

### OpenCode：本地 SQLite session database

常见形态：

- SQLite 存 `session`、`message`、`part`、`session_message` 等表。
- 查询、筛选、同步、多客户端读写更方便。
- 更适合复杂工具状态和 UI 分片。

优点：

- 查询强。
- 能建立索引。
- 更适合 session list、message part、tool state、diff summary。

缺点：

- schema 迁移复杂。
- reader 改动容易导致“数据还在，但 UI 读不到”。
- 人类排查不直观。

### 当前 Builder：SQLite event chain

Builder 当前更接近 SQLite + event sourcing：

- SQLite 是权威状态。
- `conversation_events` 是 append-only event chain。
- replay 后再投影为 renderer-safe task stream。
- revision/history 与 conversation events 分离。

优点：

- 强校验。
- 适合权限、review、draft、revision、tool admission。
- 适合 main-only authority。

风险：

- task stream reader/replay/projection 一旦失败，UI 没有 transcript fallback。
- history 与 conversation 分离，用户会看到 `Versions` 有、聊天无。
- 加载过程中多个 controller 发布中间态，容易闪烁。

## 是否应该增加文件保存

建议增加，但不要替代 SQLite。

推荐模型：

```text
SQLite = source of truth
JSONL transcript = redacted append-only audit/export/fallback
```

SQLite 继续决定：

- 权限与审批。
- draft restore。
- review/save/reject。
- project revision。
- task stream authority。
- provider/tool admission。

JSONL transcript 用于：

- 可读历史。
- 诊断与导出。
- 迁移兜底。
- 用户查看旧会话。
- 从 SQLite 读模型故障时提供只读 fallback。

## 建议方案

### S1: 稳定加载 UI，不让 foreground 反复清空

目标：

- 打开旧项目时保留 last stable project shell。
- 顶部栏按钮保持稳定，只在数据未 ready 时禁用或显示轻量 busy state。
- activity 初次加载可以显示轻量状态，但不要让已存在内容反复消失。

建议：

- 在 `BuilderApp` 增加 last-stable visible project snapshot 语义。
- `resetWorkspace` 不立即清空所有 UI 派生状态；先标记 `switchingProjectId`。
- 新 project 的 `project + history + conversation` 至少拿到 project identity 后再切换主要 UI。
- side workspace tab state 按 project identity 延迟重置。

### S2: 区分 foreground load 与 background probe

目标：

- pending draft restore 不应驱动可见 loading 闪烁。

建议：

- `restorePendingDraftFromActivity` 使用 background read/probe API，或调用 `conversation.refresh()` 并保留旧 snapshot。
- 如果必须 `load(projectId)`，controller 在同一 project、已有 snapshot 时应保留 conversation 并标记 `refreshing`。
- retry 达到上限后明确停止，并将 pending restore 标记为 exhausted，避免继续扰动 UI。

### S3: 修复旧项目无 conversation 的显示

目标：

- 不再出现 `Versions` 有、聊天永远 loading。

建议：

- task stream read 返回 `absent` 时，前端显示稳定空态：

  ```text
  No saved activity for this project.
  Versions are available in the side workspace.
  ```

- 不要将 absent 显示为 loading。
- 如果 project 有 history 但 conversation absent，提供只读 revision summary fallback。
- 添加诊断字段区分：
  - `conversation_absent`
  - `conversation_unavailable`
  - `conversation_replay_failed`
  - `conversation_migration_missing`

### S4: 增加 JSONL transcript 旁路归档

目标：

- SQLite projection 出问题时，用户仍能看到旧聊天。
- 支持导出和迁移修复。

当前文件形态（使用 Windows 可接受、不含冒号的目录名）：

```text
<userData>/builder-transcripts-v1/builder-project-<uuid>/builder-conversation-<uuid>.jsonl
```

每行是一个增量公开检查点；同一 turn/run 的状态变化用后续 sequence 覆盖，新增消息和 run 只追加变化项：

```json
{
  "schema_version": "builder-conversation-transcript-checkpoint.v1",
  "project_id": "builder-project:...",
  "conversation_id": "builder-conversation:...",
  "sequence": 12,
  "event_id": "builder-conversation-event:...",
  "event_digest": "sha256:...",
  "archived_at_ms": 123,
  "export_id": "builder-conversation-export:...",
  "source_authority": "sqlite_conversation_replay_read_only",
  "public_changes": []
}
```

注意：

- 不写 raw source tree。
- 不写 credential、provider request、secret、full private context。
- 只写经过 conversation export 严格白名单校验的 public entries。
- `event_id/sequence/digest` 用来和 SQLite 对账。

写入时机：

- SQLite `append_conversation_events(...)` 成功提交后追加 JSONL。
- 如果 JSONL 写失败，不回滚 SQLite；记录可恢复诊断。
- archive service 提供 `repair_conversation(...)` 从 SQLite 重建 JSONL；尚未暴露为普通用户按钮。

### S5: transcript fallback 只读显示

目标：

- 当 task stream replay 失败但 transcript 存在时，用户看到只读历史，而不是 loading。

建议 UI：

- 中间聊天流显示 transcript fallback items。
- 顶部显示轻量提示：

  ```text
  Showing saved transcript. Live activity is unavailable.
  ```

- 禁止基于 fallback 做权限、review、save、draft restore。
- fallback 只用于阅读、导出、诊断。

## 验收标准

### Loading / flicker

- 打开已有项目时，顶部 toolbar 不卸载重建。
- `Versions` 面板出现时，中间聊天区不会无限显示 `Loading activity...`。
- 同一 project 的 background refresh 不清空已有 activity item。
- pending draft restore retry 不触发可见 loading 闪烁。
- 切换项目最多出现一次轻量 loading state，不出现多次空白-恢复-空白循环。

### 旧会话

- 有 `conversation_events` 的旧项目能恢复完整聊天。
- 无 `conversation_events` 但有 revision/history 的旧项目显示稳定说明，不显示无限 loading。
- replay/projection 失败时显示 redacted diagnostic，不泄露内部数据。

### transcript

- [x] 每次 SQLite conversation append 成功后，JSONL transcript 有对应 sequence。
- [x] JSONL 删除后可由 SQLite 重建。
- [x] SQLite task stream 故障但 JSONL 存在时，能显示只读 fallback。
- [x] JSONL 中不包含 secret、credential、provider raw body、source_tree、absolute local path。

## 推荐优先级

1. P0: 修 `conversation.load` / pending restore 导致的 visible loading 闪烁。
2. P0: 旧项目 absent/unavailable/replay_failed 状态明确化，不再无限 loading。
3. P1: 顶部 toolbar 和 side workspace 用 last-stable project shell，避免加载时重建。
4. P1: 增加 JSONL transcript 旁路归档。
5. P2: 增加 transcript fallback viewer 和 SQLite/JSONL 对账修复工具。

## 结论

当前架构的 SQLite event chain 方向是合理的，适合 Builder 的 main-only authority、review、revision 和权限边界。但用户看到的 loading 闪烁说明前端缺少稳定合并层，旧会话加载问题说明当前只有 SQLite task stream 一条可见历史读路。

建议不要把会话权威从 SQLite 改成文件；应该增加 JSONL transcript 作为旁路归档和只读 fallback。这样既保留当前强一致、强校验的产品状态机，又能获得 Codex、Claude Code、Pi 那种“至少历史可读、可导出、可恢复”的韧性。
