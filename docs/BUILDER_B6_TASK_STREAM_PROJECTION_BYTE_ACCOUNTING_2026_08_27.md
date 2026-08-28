# Builder B6 Task Stream Projection Byte Accounting

Date: 2026-08-27

Status: first projection-byte hot-path cleanup after B5.

## Objective

B5 proved packaged task-stream IPC payloads are bounded, but it also showed
Main projection is still called hundreds of times in the packaged stress path.
B6 removes the remaining whole-result serialization from projection byte
metrics so measurement does not become part of the cost we are measuring.

## Implemented Change

`builder-conversation-main-service.cjs` now records
`main.task_stream.projection.result_bytes` by walking the already-projected
plain object graph and counting UTF-8 text/key bytes. It no longer calls
`JSON.stringify(projected)` for trace measurement.

The metric remains approximate and privacy-preserving:

- it records only byte counts;
- it does not store field values, identifiers, paths, or URLs;
- it ignores non-plain or accessor-backed values instead of invoking them;
- the task-stream IPC adapter still owns the exact plain-data validation and
  hard payload ceiling before renderer delivery.

## Boundary

B6 is not yet the full narrow-projection redesign. It removes a hot-path
measurement cost and keeps B5 evidence trustworthy. If B5/B6 traces still show
unnecessary projection frequency, B7 should coalesce lifecycle refreshes before
adding new projection shapes.

## Acceptance

B6 is accepted when:

1. Main task-stream projection byte metrics avoid whole-result
   `JSON.stringify(...)`;
2. the focused source test rejects reintroducing that measurement pattern;
3. B5 packaged stress still passes after the accounting change.
