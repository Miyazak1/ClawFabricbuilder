const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('B5 packaged stress canary hardens Main task-stream evidence', () => {
  const source = read('scripts/verify-packaged-harness-stress-canary.cjs');
  assert.match(source, /function qualifyB5PackagedEvidence\(trace\)/);
  assert.match(source, /main_task_stream_incremental_reads_min:\s*1/);
  assert.match(source, /main_task_stream_unchanged_reads_min:\s*1/);
  assert.match(source, /main_task_stream_legacy_changes_max:\s*4/);
  assert.match(source, /main\.task_stream\.ipc\.result_bytes/);
  assert.match(source, /main\.task_stream\.projection\.result_bytes/);
  assert.match(source, /b5_packaged_performance_evidence_verified:\s*true/);
  assert.match(source, /b5_packaged_evidence:\s*b5PackagedEvidence/);
  assert.match(source, /PB-07 controlled broker read search pressure/);
  assert.match(source, /function qualifyG2BrokerSchedulerEvidence\(trace\)/);
  assert.match(source, /main\.harness_tool_broker\.tool_search\.active_count/);
  assert.match(source, /g2_broker_scheduler_evidence_verified:\s*g2BrokerSchedulerEvidence !== null/);
});

test('B5 documentation records the evidence-gate boundary and medium-term plan', () => {
  const doc = read('docs/BUILDER_B5_PACKAGED_PERFORMANCE_EVIDENCE_GATE_2026_08_27.md');
  assert.match(doc, /packaged-app evidence/);
  assert.match(doc, /legacy task-stream changed hints remain bounded/);
  assert.match(doc, /B6: narrow task-stream projections/);
  assert.match(doc, /C1: stabilize Browser\/Preview/);
  assert.match(doc, /D1: expose runtime policy settings/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B5_PACKAGED_PERFORMANCE_EVIDENCE_GATE_2026_08_27\.md/);
});
