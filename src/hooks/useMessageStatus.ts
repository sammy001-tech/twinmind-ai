import { useState, useEffect } from 'react';
import { ChatMessage } from '../types';

/**
 * Expose statuses that already exist on messages. Absence of provider state is
 * represented by absence from this map, not guessed from the message role.
 */
export const useMessageStatus = (messages: ChatMessage[]) => {
  const [messageStatuses, setMessageStatuses] = useState<Record<string, NonNullable<ChatMessage['status']>>>({});

  useEffect(() => {
    const initialStatuses: Record<string, NonNullable<ChatMessage['status']>> = {};
    messages.forEach((msg) => {
      if (msg.status) initialStatuses[msg.id] = msg.status;
    });
    setMessageStatuses(initialStatuses);
  }, [messages]);

  return messageStatuses;
};
