import type { BuilderConversationSnapshot } from './builderConversationSnapshot';

export function hasActiveProgrammingTask(snapshot: BuilderConversationSnapshot | null): boolean {
  if (snapshot?.state !== 'ready' || snapshot.scope_kind === 'agent_conversation') return false;
  const { items, recorded_active_turn_id: turnId } = snapshot.conversation;
  const run = [...items].reverse().find((item) => item.item_kind === 'run_started' && item.turn_id === turnId);
  return run?.item_kind === 'run_started' && items.some((item) =>
    (item.item_kind === 'programming_runtime_tool_activity' || item.item_kind === 'programming_runtime_status')
    && item.run_id === run.run_id);
}

export function interruptedTaskContinuation(snapshot: BuilderConversationSnapshot | null) {
  if (snapshot?.state !== 'ready' || snapshot.scope_kind === 'agent_conversation') return null;
  const conversation = snapshot.conversation;
  if (conversation.recorded_active_turn_id !== null) return null;
  const items = [...conversation.items].reverse();
  const latestRun = items.find((item) => item.item_kind === 'run_started');
  const terminal = items.find((item) => item.item_kind === 'run_completed');
  if (!latestRun || !terminal || terminal.run_id !== latestRun.run_id
    || terminal.terminal_status !== 'interrupted' || terminal.candidate !== null) return null;
  const message = items.find((item) => item.item_kind === 'user_message'
    && item.turn_id === terminal.turn_id && item.message_kind === 'submitted');
  if (message?.item_kind !== 'user_message') return null;
  const context = items.find((item) => item.item_kind === 'run_context_snapshot_recorded'
    && item.run_id === terminal.run_id);
  const route = context?.item_kind === 'run_context_snapshot_recorded' ? context.context.route : null;
  if (route !== 'build' && !(route === null && message.mode === 'work')) return null;
  return {
    runId: terminal.run_id,
    instruction: message.message.text,
    composerMode: 'build' as const,
  };
}
