export type MessageDeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'undelivered'
  | 'error';

const KNOWN_DELIVERY_STATUSES = new Set<string>([
  'pending',
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'undelivered',
]);

/**
 * Only map values obtained from persisted provider state. Missing or unknown
 * fields remain unknown; they are never inferred from a message's role/channel.
 */
export function resolvePersistedMessageStatus(value: unknown): MessageDeliveryStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const status = value.trim().toLowerCase();
  if (KNOWN_DELIVERY_STATUSES.has(status)) return status as MessageDeliveryStatus;
  if (status === 'failed' || status === 'canceled' || status === 'partially_delivered') return 'error';
  return undefined;
}

export function getMessageDeliveryStatusLabel(status: MessageDeliveryStatus): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'accepted': return 'Accepted by provider';
    case 'queued': return 'Queued';
    case 'sending': return 'Sending';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'read': return 'Read';
    case 'undelivered': return 'Undelivered';
    case 'error': return 'Failed';
  }
}

export type MessageProcessingStatus = 'processing' | 'completed' | 'failed';

export function resolveMessageProcessingStatus(value: unknown): MessageProcessingStatus | undefined {
  if (value === 'processing' || value === 'completed' || value === 'failed') return value;
  return undefined;
}
