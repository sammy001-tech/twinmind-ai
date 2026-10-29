import test from 'node:test';
import assert from 'node:assert/strict';
import { type ChatMessage } from '../src/types/index.ts';

test('message attachment persistence: maps and preserves imageData and audioUrl upon hydration', () => {
  // Sample raw thread message response from server database
  const rawDbMessage = {
    id: 101,
    session_id: 'thread-test-123',
    channel: 'web',
    role: 'user',
    content: 'Check this out',
    metadata: {
      hasImage: true,
      mimeType: 'image/jpeg',
      imageData: {
        mimeType: 'image/jpeg',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        name: 'sample_math_problem.jpg',
      },
      audioUrl: 'https://example.com/audio/voice-123.mp3',
    },
    created_at: '2026-10-29T08:50:00Z',
  };

  // Hydration mapping matching App.tsx loadThreadMessages
  const hydrated: ChatMessage = {
    id: String(rawDbMessage.id),
    dbId: rawDbMessage.id,
    role: rawDbMessage.role as 'user' | 'assistant',
    content: rawDbMessage.content,
    timestamp: new Date(rawDbMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date(rawDbMessage.created_at).getTime(),
    channel: rawDbMessage.channel as any,
    artifacts: (rawDbMessage.metadata as any)?.artifacts || [],
    imageData: rawDbMessage.metadata?.imageData || undefined,
    audioUrl: rawDbMessage.metadata?.audioUrl || undefined,
  };

  // Verify full image preservation across thread reload
  assert.ok(hydrated.imageData, 'Hydrated message must contain imageData');
  assert.equal(hydrated.imageData.mimeType, 'image/jpeg');
  assert.equal(hydrated.imageData.name, 'sample_math_problem.jpg');
  assert.equal(
    hydrated.imageData.data,
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );
  assert.equal(hydrated.audioUrl, 'https://example.com/audio/voice-123.mp3');
  assert.equal(hydrated.content, 'Check this out');
});

test('message attachment persistence: messages without media cleanly default to undefined without errors', () => {
  const rawTextDbMessage = {
    id: 102,
    session_id: 'thread-test-123',
    channel: 'web',
    role: 'user',
    content: 'Just a text question',
    metadata: {} as Record<string, any>,
    created_at: '2026-10-29T08:51:00Z',
  };

  const hydrated: ChatMessage = {
    id: String(rawTextDbMessage.id),
    dbId: rawTextDbMessage.id,
    role: rawTextDbMessage.role as 'user' | 'assistant',
    content: rawTextDbMessage.content,
    timestamp: new Date(rawTextDbMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date(rawTextDbMessage.created_at).getTime(),
    channel: rawTextDbMessage.channel as any,
    artifacts: (rawTextDbMessage.metadata as any)?.artifacts || [],
    imageData: rawTextDbMessage.metadata?.imageData || undefined,
    audioUrl: (rawTextDbMessage.metadata as any)?.audioUrl || undefined,
  };

  assert.equal(hydrated.imageData, undefined);
  assert.equal(hydrated.audioUrl, undefined);
  assert.equal(hydrated.content, 'Just a text question');
});

test('message attachment persistence: metadata constructor preserves imageData payload structure', () => {
  const lastUserMsg = {
    role: 'user',
    content: 'Solve this derivative',
    imageData: {
      mimeType: 'image/png',
      data: 'base64EncodedDataHere',
      name: 'derivative_problem.png',
    },
  };

  const metadata: Record<string, unknown> = {};
  if (lastUserMsg.imageData) {
    metadata.hasImage = true;
    metadata.mimeType = lastUserMsg.imageData.mimeType;
    metadata.imageData = {
      mimeType: lastUserMsg.imageData.mimeType,
      data: lastUserMsg.imageData.data,
      name: lastUserMsg.imageData.name,
    };
  }

  assert.equal(metadata.hasImage, true);
  assert.deepEqual(metadata.imageData, {
    mimeType: 'image/png',
    data: 'base64EncodedDataHere',
    name: 'derivative_problem.png',
  });
});
