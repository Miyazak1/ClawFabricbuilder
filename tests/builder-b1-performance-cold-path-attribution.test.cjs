'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

test('B1 performance attribution document keeps the next slice narrow and measured', () => {
  const doc = fs.readFileSync(
    path.join(repositoryRoot, 'docs', 'BUILDER_B1_PERFORMANCE_COLD_PATH_ATTRIBUTION_2026_08_27.md'),
    'utf8',
  );

  assert.match(doc, /submit -> Main admission -> runtime streaming -> durable event persistence/u);
  assert.match(doc, /main\.harness_runtime\.record_events/u);
  assert.match(doc, /main\.harness_response\.reconcile/u);
  assert.match(doc, /main\.conversation\.append/u);
  assert.match(doc, /main\.task_stream\.projection/u);
  assert.match(doc, /main\.task_stream\.ipc/u);
  assert.match(doc, /durable terminal settlement\s+decoupling/u);
});

test('B1 performance attribution rejects Browser, sandbox, Workbench, and dependency-install scope creep', () => {
  const doc = fs.readFileSync(
    path.join(repositoryRoot, 'docs', 'BUILDER_B1_PERFORMANCE_COLD_PATH_ATTRIBUTION_2026_08_27.md'),
    'utf8',
  );

  assert.match(doc, /This is not a Browser Node, sandbox, or Workbench\s+implementation gate/u);
  assert.match(doc, /adding Browser Node, sandbox provider, or Workbench plugin architecture work\s+to the same change/u);
  assert.match(doc, /Browser\s+contracts remain separate from command execution/u);
  assert.match(doc, /detect before install/u);
  assert.match(doc, /no project-root\s+install from Settings/u);
});

test('performance trace allowlist covers the B1 cold-path attribution buckets', () => {
  const traceSource = fs.readFileSync(
    path.join(repositoryRoot, 'electron', 'builder-performance-trace.cjs'),
    'utf8',
  );

  for (const metric of [
    'main.harness_runtime.record_events.duration_ms',
    'main.harness_runtime.persist_event.duration_ms',
    'main.harness_runtime.flush_pending_events.duration_ms',
    'main.harness_response.reconcile.duration_ms',
    'main.harness_runtime.reconcile_run.duration_ms',
    'main.harness_runner.reconcile_runtime.duration_ms',
    'main.conversation.append.duration_ms',
    'main.conversation.load.duration_ms',
    'main.conversation.load.full_read_count',
    'main.conversation.load.suffix_hit_count',
    'main.task_stream.projection.duration_ms',
    'main.task_stream.projection.result_bytes',
    'main.task_stream.ipc.duration_ms',
    'main.task_stream.ipc.result_bytes',
    'main.task_stream.cursor.full_count',
    'main.task_stream.cursor.incremental_count',
  ]) {
    assert.match(traceSource, new RegExp(metric.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});
