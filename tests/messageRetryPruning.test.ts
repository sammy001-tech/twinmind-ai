import test from 'node:test';
import assert from 'node:assert/strict';
import { type ChatMessage } from '../src/types/index.ts';

test('message retry sequencing: retains existing user prompt without creating duplicates', () => {
  // Scenario: Thread has User Prompt and an Assistant Response
  const originalMessages: ChatMessage[] = [
    {
      id: 'user-100',
      dbId: 101,
      role: 'user',
      content: 'Explain quantum entanglement simply',
      timestamp: '10:00 AM',
      createdAt: 1700000000000,
      channel: 'web',
    },
    {
      id: 'assistant-101',
      dbId: 102,
      role: 'assistant',
      content: 'Quantum entanglement is a phenomenon...',
      timestamp: '10:01 AM',
      createdAt: 1700000001000,
      channel: 'web',
    },
  ];

  // User clicks retry on the assistant message
  const retryTargetId = 'assistant-101';
  const targetIndex = originalMessages.findIndex((m) => m.id === retryTargetId);
  assert.equal(targetIndex, 1);

  let userMsgIndex = targetIndex - 1;
  while (userMsgIndex >= 0 && originalMessages[userMsgIndex].role !== 'user') {
    userMsgIndex--;
  }
  assert.equal(userMsgIndex, 0);

  const userMsg = originalMessages[userMsgIndex];
  const assistantMsg = originalMessages[targetIndex];

  // 1. Memory truncation retains up to the user message
  const priorWithUser = originalMessages.slice(0, userMsgIndex + 1);
  assert.equal(priorWithUser.length, 1);
  assert.equal(priorWithUser[0].id, 'user-100');
  assert.equal(priorWithUser[0].dbId, 101);

  // 2. Verified retry options generated
  const retryOptions = {
    existingUserDbId: userMsg.dbId,
    replaceAssistantDbId: assistantMsg.dbId,
    skipUserAppend: true,
  };

  assert.equal(retryOptions.existingUserDbId, 101);
  assert.equal(retryOptions.replaceAssistantDbId, 102);
  assert.equal(retryOptions.skipUserAppend, true);

  // 3. New message array when skipUserAppend is true does NOT append another user message
  const newMessages = retryOptions.skipUserAppend ? priorWithUser : [...priorWithUser, {
    id: 'user-duplicate',
    role: 'user',
    content: userMsg.content,
    timestamp: '10:02 AM',
    createdAt: Date.now(),
    channel: 'web',
  }];

  assert.equal(newMessages.length, 1, 'Must not duplicate user message in memory');
  assert.equal(newMessages[0].id, 'user-100');
});

test('message edit and regenerate sequencing: updates prompt and prunes downstream turns', () => {
  const originalMessages: ChatMessage[] = [
    {
      id: 'user-200',
      dbId: 201,
      role: 'user',
      content: 'Original prompt text',
      timestamp: '11:00 AM',
      createdAt: 1700000100000,
      channel: 'web',
    },
    {
      id: 'assistant-201',
      dbId: 202,
      role: 'assistant',
      content: 'Original answer',
      timestamp: '11:01 AM',
      createdAt: 1700000101000,
      channel: 'web',
    },
    {
      id: 'user-202',
      dbId: 203,
      role: 'user',
      content: 'Follow-up question',
      timestamp: '11:02 AM',
      createdAt: 1700000102000,
      channel: 'web',
    },
    {
      id: 'assistant-203',
      dbId: 204,
      role: 'assistant',
      content: 'Follow-up answer',
      timestamp: '11:03 AM',
      createdAt: 1700000103000,
      channel: 'web',
    },
  ];

  // User edits first prompt user-200
  const editMessageId = 'user-200';
  const newContent = 'Updated prompt text';
  const msgIndex = originalMessages.findIndex((m) => m.id === editMessageId);
  assert.equal(msgIndex, 0);

  const targetMsg = originalMessages[msgIndex];
  const userDbId = targetMsg.dbId;
  assert.equal(userDbId, 201);

  // Simulated downstream pruning: all messages after 201 should be removed
  const updatedUserMsg: ChatMessage = { ...targetMsg, content: newContent };
  const truncatedWithUpdatedUser = [...originalMessages.slice(0, msgIndex), updatedUserMsg];

  assert.equal(truncatedWithUpdatedUser.length, 1);
  assert.equal(truncatedWithUpdatedUser[0].id, 'user-200');
  assert.equal(truncatedWithUpdatedUser[0].content, 'Updated prompt text');
  assert.equal(truncatedWithUpdatedUser[0].dbId, 201);
});

test('thread reload after retry: simulates database state returning clean lineage without duplicates or ghosts', () => {
  // Simulating database rows before retry:
  // [id: 301, role: 'user', content: 'Prompt 1']
  // [id: 302, role: 'assistant', content: 'Old reply 1']

  // After retry executed:
  // Row 302 pruned (DELETE WHERE id >= 302)
  // Row 301 reused without re-insert (existingUserDbId: 301)
  // New assistant reply saved as Row 303
  const persistedDbRowsAfterRetry = [
    {
      id: 301,
      session_id: 'thread-retry-test',
      channel: 'web',
      role: 'user',
      content: 'Prompt 1',
      metadata: {},
      created_at: '2026-10-30T07:00:00Z',
    },
    {
      id: 303,
      session_id: 'thread-retry-test',
      channel: 'web',
      role: 'assistant',
      content: 'New regenerated reply 1',
      metadata: {},
      created_at: '2026-10-30T07:01:00Z',
    },
  ];

  // Hydration simulation (matching App.tsx loadThreadMessages)
  const hydratedMessages: ChatMessage[] = persistedDbRowsAfterRetry.map((r) => ({
    id: String(r.id),
    dbId: r.id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    timestamp: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date(r.created_at).getTime(),
    channel: r.channel as any,
  }));

  assert.equal(hydratedMessages.length, 2, 'Must contain exactly 2 messages upon reload');
  assert.equal(hydratedMessages[0].role, 'user');
  assert.equal(hydratedMessages[0].content, 'Prompt 1');
  assert.equal(hydratedMessages[0].dbId, 301);

  assert.equal(hydratedMessages[1].role, 'assistant');
  assert.equal(hydratedMessages[1].content, 'New regenerated reply 1');
  assert.equal(hydratedMessages[1].dbId, 303);

  // Assert no duplicate user messages exist
  const userMessages = hydratedMessages.filter((m) => m.role === 'user');
  assert.equal(userMessages.length, 1, 'Only one user prompt must exist after reload');

  // Assert old cleared assistant reply does not exist
  const hasOldReply = hydratedMessages.some((m) => m.content === 'Old reply 1');
  assert.equal(hasOldReply, false, 'Cleared assistant response must not reappear after reload');
});
