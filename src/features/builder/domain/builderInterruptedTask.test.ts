import { describe, expect, it } from 'vitest';
import { createInterruptedTaskStreamWire, createProgressTaskStreamWire, createTaskStreamWire } from '../../../test/builderV2Fixtures';
import { sanitizeBuilderConversationSnapshot } from './builderConversationSnapshot';
import { interruptedTaskContinuation } from './builderInterruptedTask';

describe('interruptedTaskContinuation', () => {
  it.each([['build', 'build']] as const)(
    'preserves the original %s route and complete submitted instruction', (route, mode) => {
      const wire = createInterruptedTaskStreamWire(route);
      const original = createTaskStreamWire().conversation.items[0];
      const result = interruptedTaskContinuation(sanitizeBuilderConversationSnapshot(wire));
      expect(result).toEqual({ runId: expect.stringMatching(/^builder-run:/u), instruction: original.message?.text, composerMode: mode });
    },
  );
  it.each(['plan', 'answer'] as const)('does not offer native build recovery for %s turns', route => {
    expect(interruptedTaskContinuation(sanitizeBuilderConversationSnapshot(createInterruptedTaskStreamWire(route)))).toBeNull();
  });
  it('never resumes a live run or a completed draft', () => {
    for (const wire of [createProgressTaskStreamWire(), createTaskStreamWire()]) {
      expect(interruptedTaskContinuation(sanitizeBuilderConversationSnapshot(wire))).toBeNull();
    }
  });
});
