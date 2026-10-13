import { useState, useEffect } from 'react';
import { ChatMessage } from '../types';

export const useMessageStatus = (messages: ChatMessage[]) => {
  const [messageStatuses, setMessageStatuses] = useState<Record<string, 'pending' | 'sent' | 'delivered' | 'read' | 'error'>>({});

  useEffect(() => {
    // In a real application, this would subscribe to WebSocket events 
    // or poll an endpoint to update statuses for Telegram/WhatsApp messages.
    // For now, we initialize from existing messages.
    const initialStatuses: Record<string, 'pending' | 'sent' | 'delivered' | 'read' | 'error'> = {};
    messages.forEach((msg) => {
      if (msg.status) {
        initialStatuses[msg.id] = msg.status;
      } else if (msg.role === 'user') {
        initialStatuses[msg.id] = 'sent';
      } else {
        initialStatuses[msg.id] = 'read';
      }
    });
    setMessageStatuses(initialStatuses);
  }, [messages]);

  return messageStatuses;
};
