import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAiSseState,
  processOpenAiSseLine,
  finalizeOpenAiSseState,
  readOpenAiCompatibleStream,
} from '../server/services/twinAgentService.ts';
import { buildSystemPrompt } from '../src/prompt/masterPrompt.ts';

test('processOpenAiSseLine accumulates streamed text deltas and fragmented tool_calls', () => {
  const state = createOpenAiSseState();
  const deltas: string[] = [];

  processOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"Hello "}}]}',
    state,
    (d) => deltas.push(d)
  );
  processOpenAiSseLine(
    'data: {"choices":[{"delta":{"content":"TwinMind"}}]}',
    state,
    (d) => deltas.push(d)
  );
  processOpenAiSseLine(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}',
    state,
    (d) => deltas.push(d)
  );
  processOpenAiSseLine(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"Web","arguments":"\\"EUR/USD\\"}"}}]}}]}',
    state,
    (d) => deltas.push(d)
  );
  processOpenAiSseLine('data: [DONE]', state, (d) => deltas.push(d));

  assert.equal(state.done, true);
  assert.deepEqual(deltas, ['Hello ', 'TwinMind']);

  const finalized = finalizeOpenAiSseState(state);
  assert.equal(finalized.role, 'assistant');
  assert.equal(finalized.content, 'Hello TwinMind');
  assert.equal(finalized.tool_calls?.length, 1);
  assert.equal(finalized.tool_calls?.[0].id, 'call_abc');
  assert.equal(finalized.tool_calls?.[0].function.name, 'searchWeb');
  assert.equal(finalized.tool_calls?.[0].function.arguments, '{"q":"EUR/USD"}');
});

test('processOpenAiSseLine surfaces upstream SSE JSON errors explicitly without swallowing', () => {
  const state = createOpenAiSseState();
  assert.throws(
    () =>
      processOpenAiSseLine(
        'data: {"error":{"message":"Rate limit reached on live provider"}}',
        state
      ),
    /Provider stream error: Rate limit reached on live provider/
  );
});

test('readOpenAiCompatibleStream reassembles split SSE chunks and rejects null body', async () => {
  await assert.rejects(
    () => readOpenAiCompatibleStream(null),
    /PROVIDER_STREAM_UNAVAILABLE/
  );

  const encoder = new TextEncoder();
  const fullPayload = [
    'data: {"choices":[{"delta":{"content":"Part 1"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" + Part 2"}}]}\n\n',
    'data: [DONE]\n',
  ].join('');

  // Deliberately split mid-JSON across chunks to verify line buffering
  const splitPoint = Math.floor(fullPayload.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(fullPayload.slice(0, splitPoint)));
      controller.enqueue(encoder.encode(fullPayload.slice(splitPoint)));
      controller.close();
    },
  });

  const streamedChunks: string[] = [];
  const result = await readOpenAiCompatibleStream(stream, (delta) => streamedChunks.push(delta));
  assert.deepEqual(streamedChunks, ['Part 1', ' + Part 2']);
  assert.equal(result.content, 'Part 1 + Part 2');
});

test('buildSystemPrompt injects valid pinnedDocs with untrusted framing and skips empty docs', () => {
  const oversizedText = 'A'.repeat(13000);
  const prompt = buildSystemPrompt({
    channel: 'web',
    pinnedDocs: [
      {
        file_name: 'empty_ignore.txt',
        format: 'txt',
        content: '   ',
      },
      {
        file_name: 'Trading_Plan.pdf',
        format: 'pdf',
        content: oversizedText,
      },
    ],
  });

  assert.ok(prompt.includes('PINNED THREAD REFERENCE DOCUMENTS'));
  assert.ok(prompt.includes('[Pinned Document: "Trading_Plan.pdf" (PDF)]'));
  assert.ok(prompt.includes('untrusted reference evidence'));
  assert.ok(prompt.includes('truncated at 12000 chars out of 13000 chars'));
  assert.ok(!prompt.includes('empty_ignore.txt'));
});
