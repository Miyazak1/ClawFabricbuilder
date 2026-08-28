# Builder B4 Task Stream Payload Budget And Cursor Hardening

Date: 2026-08-27

Status: first payload-budget implementation after B3.

## Objective

B4 moves from "how many task-stream reads happen" to "how expensive each read
is." B3 reduced duplicate reads around terminal settlement and pending draft
restore. B4 hardens task-stream payload accounting so measuring large
conversations does not itself add another large serialization cost.

## Implemented Change

Both task-stream IPC layers already enforce a 4 MiB plain-data ceiling and a
cursor protocol with `full`, `incremental`, and `unchanged` results. Before B4,
trace byte metrics used `JSON.stringify(...)` on the task-stream result after
the plain-data validation pass. On large histories, that made performance trace
pay for an extra full serialization exactly where the UI is most sensitive.

B4 changes the byte accounting path:

- Main `builder-task-stream-ipc-adapter.cjs` records
  `main.task_stream.ipc.result_bytes` from the same plain-data clone pass used
  for IPC safety.
- Renderer `builderDesktopTaskStreamPort.ts` records
  `renderer.task_stream.read.result_bytes` from the same plain-graph clone pass
  used for renderer safety.
- Neither layer stringifies the whole task-stream result just to observe
  payload size.

## Cursor Contract

B4 keeps the existing cursor behavior:

- first cursor read returns `full`;
- same digest returns `unchanged`;
- append-only public windows return `incremental`;
- invalid, unsupported, or stale cursor states fail closed or fall back to full
  without giving renderer cursor authority over Main storage.

The next optimization should use trace evidence to decide whether to add
narrower terminal-only projections or stricter payload canaries for very large
conversations.

## Boundaries

- Payload accounting must not record content, identifiers, paths, or URLs.
- Payload accounting must not invoke accessor/proxy output behavior.
- Main/SQLite remain canonical for event replay and review state.
- Browser/Preview and Side Workspace remain independent capability surfaces;
  task-stream payload work does not mount or refresh them.
- Dependency preparation remains A1-owned and is not part of B4.

## Acceptance

B4 is accepted when:

1. Main task-stream IPC result byte accounting avoids whole-result
   `JSON.stringify(...)`;
2. renderer task-stream read byte accounting avoids raw-wire
   `JSON.stringify(...)`;
3. cursor full/unchanged/incremental behavior remains covered;
4. trace allowlists include task-stream read count, duration, result bytes, and
   cursor result counts;
5. focused IPC, renderer port, performance trace, source, and type checks pass.
