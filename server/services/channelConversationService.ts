import { createHash } from 'node:crypto';
import { neonDb } from '../db/neonService.ts';
import type { ExternalChannel } from './channelMessagePolicy.ts';

export type ConversationRole = 'user' | 'assistant';

export interface PersistChannelMessageInput {
  channel: ExternalChannel;
  externalIdentity: string | number;
  role: ConversationRole;
  content: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  deliveryStatus?: 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';
  providerMessageSid?: string;
  errorCode?: string;
}

export function getChannelThreadId(channel: ExternalChannel, externalIdentity: string | number): string {
  const identity = String(externalIdentity ?? '').trim();
  if (!identity) throw new Error('CHANNEL_IDENTITY_REQUIRED');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `${channel}-${digest}`;
}

export async function ensureChannelThread(
  channel: ExternalChannel,
  externalIdentity: string | number,
  title: string,
): Promise<string> {
  const sessionId = getChannelThreadId(channel, externalIdentity);
  const safeTitle = title.trim().slice(0, 48) || `${channel} conversation`;
  const persisted = await neonDb.ensureThread({ id: sessionId, title: safeTitle, channel });
  if (!persisted) throw new Error('PERSISTENCE_FAILED: channel conversation thread was not saved');
  return sessionId;
}

/**
 * Persist a real message and its current provider state. Callers that send an
 * outbound message should first save it with deliveryStatus='pending', perform
 * the provider request, then update that same message with the provider SID and
 * the actual status returned by a provider callback.
 */
export async function persistChannelMessage(input: PersistChannelMessageInput): Promise<{ threadId: string; messageId: number }> {
  const title = input.role === 'user' ? input.content : '';
  const threadId = await ensureChannelThread(input.channel, input.externalIdentity, title);
  const metadata: Record<string, unknown> = {
    ...(input.metadata || {}),
    ...(input.deliveryStatus ? { deliveryStatus: input.deliveryStatus } : {}),
    ...(input.providerMessageSid ? { providerMessageSid: input.providerMessageSid } : {}),
    ...(input.errorCode ? { deliveryErrorCode: input.errorCode } : {}),
  };

  const messageId = await neonDb.saveMessage({
    session_id: threadId,
    channel: input.channel,
    role: input.role,
    content: input.content,
    provider: input.provider,
    model: input.model,
    metadata,
  });
  if (messageId === undefined) throw new Error('PERSISTENCE_FAILED: channel message was not saved');
  return { threadId, messageId };
}

export async function persistInboundChannelMessage(
  input: Omit<PersistChannelMessageInput, 'deliveryStatus' | 'providerMessageSid' | 'errorCode'>,
  providerMessageId: string,
): Promise<{ threadId: string; messageId: number; isDuplicate: boolean }> {
  if (!providerMessageId.trim()) throw new Error('CHANNEL_PROVIDER_MESSAGE_ID_REQUIRED');
  const threadId = await ensureChannelThread(input.channel, input.externalIdentity, input.role === 'user' ? input.content : '');
  const result = await neonDb.saveInboundChannelMessage({
    session_id: threadId,
    channel: input.channel,
    role: input.role,
    content: input.content,
    provider: input.provider,
    model: input.model,
    metadata: input.metadata || {},
  }, providerMessageId.trim());

  if (!result) throw new Error('PERSISTENCE_FAILED: inbound channel message was not durably saved');
  return { threadId, messageId: result.id, isDuplicate: result.isDuplicate };
}

export async function loadChannelConversationHistory(
  channel: ExternalChannel,
  externalIdentity: string | number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const threadId = await ensureChannelThread(channel, externalIdentity, `${channel} conversation`);
  const messages = await neonDb.getThreadMessagesStrict(threadId);
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
    .slice(-20);
}
