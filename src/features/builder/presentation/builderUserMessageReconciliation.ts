import type { BuilderConversationItem } from '../domain/builderConversationSnapshot';

export type BuilderPendingUserMessage = Readonly<{
  client_id: string;
  message_id?: string | null;
  text: string;
  message_kind: 'submitted' | 'queued_followup' | 'steering';
  minimum_sequence?: number;
  turn_id?: string | null;
}>;

export type BuilderDurableUserMessage = Readonly<{
  message_id: string;
  message_kind: BuilderPendingUserMessage['message_kind'];
  sequence: number;
  text: string;
  turn_id: string;
}>;

export function builderPendingUserMessageMatchesDurable(
  pending: BuilderPendingUserMessage,
  durable: BuilderDurableUserMessage,
): boolean {
  if (pending.message_id !== null && pending.message_id !== undefined) {
    return durable.message_id === pending.message_id;
  }
  if (pending.turn_id !== null && pending.turn_id !== undefined) {
    return durable.turn_id === pending.turn_id
      && durable.message_kind === pending.message_kind
      && durable.text === pending.text;
  }
  return durable.sequence > (pending.minimum_sequence ?? -1)
    && durable.message_kind === pending.message_kind
    && durable.text === pending.text;
}

export function builderDurableUserMessage(
  item: BuilderConversationItem,
): BuilderDurableUserMessage | null {
  if (item.item_kind === 'user_message') {
    return Object.freeze({
      message_id: item.message.message_id,
      message_kind: item.message_kind,
      sequence: item.sequence,
      text: item.message.text,
      turn_id: item.turn_id,
    });
  }
  if (
    item.item_kind !== 'transcript_message'
    || item.role !== 'user'
    || item.message_kind === 'run_result'
    || item.message_kind === 'incomplete_result'
  ) return null;
  return Object.freeze({
    message_id: item.message.message_id,
    message_kind: item.message_kind,
    sequence: item.sequence,
    text: item.message.text,
    turn_id: item.turn_id,
  });
}
