const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readActivityAfterTerminalBody() {
  const source = read('src/app/BuilderApp.tsx');
  const start = source.indexOf('const readActivityAfterTerminal = useCallback(async (');
  assert.notEqual(start, -1, 'BuilderApp must define readActivityAfterTerminal');
  const end = source.indexOf('const runBuildInstruction = useCallback((', start);
  assert.notEqual(end, -1, 'readActivityAfterTerminal block must end before runBuildInstruction');
  return source.slice(start, end);
}

test('known-task terminal settlement does not refresh the project tree before reading activity', () => {
  const body = readActivityAfterTerminalBody();
  assert.match(
    body,
    /currentConversationTaskAddressId\s*=\s*conversation\.snapshot\.project_id\s*===\s*conversationProjectId[\s\S]*conversation\.snapshot\.task_address_id/,
    'terminal settlement should prefer the already loaded conversation task address',
  );
  assert.match(
    body,
    /let\s+nextTaskAddressId\s*=\s*currentConversationTaskAddressId\s*\?\?\s*taskAddressId/,
    'terminal settlement should reuse the selected task address before falling back to tree discovery',
  );
  assert.match(
    body,
    /if\s*\(\s*nextTaskAddressId\s*===\s*null\s*\)\s*\{[\s\S]*agentProjectTree\.refresh\(\)[\s\S]*firstTaskAddressForProject/,
    'project-tree refresh should be guarded by the missing-task-address fallback',
  );
  assert.doesNotMatch(
    body,
    /const\s+refreshedTree\s*=\s*await\s+boundedPostTerminalRefresh\(agentProjectTree\.refresh\(\),\s*null\);\s*const\s+nextTaskAddressId/,
    'terminal settlement must not unconditionally refresh the project tree before choosing a task address',
  );
});

test('B2 documentation keeps terminal settlement scoped away from unrelated architecture work', () => {
  const doc = read('docs/BUILDER_B2_DURABLE_TERMINAL_SETTLEMENT_DECOUPLING_2026_08_27.md');
  assert.match(doc, /known task terminal settlement refreshes the conversation, not the whole project tree/);
  assert.match(doc, /Browser\/Preview is not part of this sandbox or settlement path/);
  assert.match(doc, /Dependency preparation and install approval are not part of this performance/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B2_DURABLE_TERMINAL_SETTLEMENT_DECOUPLING_2026_08_27\.md/);
});
