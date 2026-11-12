import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDuplicateVaultDocuments } from '../server/services/vaultMemoryUpdateService.ts';
import {
  validateScheduledCheckinInput,
  formatCheckinMessage,
} from '../server/services/scheduledCheckinService.ts';
import {
  GEMINI_TWIN_TOOLS,
  OPENAI_COMPATIBLE_TWIN_TOOLS,
} from '../server/services/twinAgentService.ts';

test('scanDuplicateVaultDocuments clusters exact and near-duplicate records without grouping unrelated docs', () => {
  assert.deepEqual(scanDuplicateVaultDocuments([]), []);
  assert.deepEqual(
    scanDuplicateVaultDocuments([{ id: 1, title: 'Solo Note', content: 'Only one record' }]),
    []
  );

  const clusters = scanDuplicateVaultDocuments([
    {
      id: 1,
      title: 'Forex Training Journey',
      category: 'workflow',
      content: 'Demo trading only on EUR/USD via Deriv MT5. Every lesson includes video lessons.',
    },
    {
      id: 2,
      title: 'Forex Training Journey!',
      category: 'workflow',
      content: 'Demo trading only on EUR/USD via Deriv MT5.',
    },
    {
      id: 3,
      title: 'Forex Learning Journey Rules',
      category: 'workflow',
      content: 'Demo trading only on EUR/USD via Deriv MT5 and every lesson includes video lessons and charts.',
    },
    {
      id: 4,
      title: 'Quarterly Tax Filing Checklist',
      category: 'reference',
      content: 'Collect VAT receipts, payroll ledger summaries, and contractor W-9 forms before filing.',
    },
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].primaryId, 1);
  const matchedIds = clusters[0].matches.map((m) => m.id).sort();
  assert.deepEqual(matchedIds, [2, 3]);
  assert.ok(clusters[0].matches.every((m) => m.id !== 4));
});

test('validateScheduledCheckinInput enforces explicit channel, title, prompt, and future schedule time', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);

  const validDelay = validateScheduledCheckinInput(
    {
      title: 'Lesson 2 Chart Review',
      prompt: 'Share your EUR/USD M15 screenshot when ready.',
      channel: 'telegram',
      delayMinutes: 45,
      journeyId: 7,
      threadId: 'thread-abc',
    },
    now
  );
  assert.equal(validDelay.valid, true);
  if (validDelay.valid) {
    assert.equal(validDelay.value.channel, 'telegram');
    assert.equal(validDelay.value.journeyId, 7);
    assert.equal(validDelay.value.threadId, 'thread-abc');
    assert.equal(validDelay.value.dueAt, new Date(now + 45 * 60_000).toISOString());
  }

  const validIso = validateScheduledCheckinInput(
    {
      title: 'Weekly Calibration Follow-Up',
      prompt: 'Record the actual outcome of your vendor decision.',
      channel: 'whatsapp',
      dueAt: new Date(now + 3600_000).toISOString(),
    },
    now
  );
  assert.equal(validIso.valid, true);

  const missingTitle = validateScheduledCheckinInput(
    { title: ' ', prompt: 'Hello', channel: 'telegram', delayMinutes: 10 },
    now
  );
  assert.equal(missingTitle.valid, false);
  if (!missingTitle.valid) assert.equal(missingTitle.code, 'CHECKIN_TITLE_REQUIRED');

  const missingPrompt = validateScheduledCheckinInput(
    { title: 'Check-in', prompt: '', channel: 'telegram', delayMinutes: 10 },
    now
  );
  assert.equal(missingPrompt.valid, false);
  if (!missingPrompt.valid) assert.equal(missingPrompt.code, 'CHECKIN_PROMPT_REQUIRED');

  const invalidChannel = validateScheduledCheckinInput(
    { title: 'Check-in', prompt: 'Ping me', channel: 'web', delayMinutes: 10 },
    now
  );
  assert.equal(invalidChannel.valid, false);
  if (!invalidChannel.valid) assert.equal(invalidChannel.code, 'CHECKIN_CHANNEL_INVALID');

  const pastDue = validateScheduledCheckinInput(
    {
      title: 'Check-in',
      prompt: 'Late ping',
      channel: 'telegram',
      dueAt: new Date(now - 5 * 60_000).toISOString(),
    },
    now
  );
  assert.equal(pastDue.valid, false);
  if (!pastDue.valid) assert.equal(pastDue.code, 'CHECKIN_DUE_AT_IN_PAST');

  const invalidDelay = validateScheduledCheckinInput(
    { title: 'Check-in', prompt: 'Ping', channel: 'whatsapp', delayMinutes: 0 },
    now
  );
  assert.equal(invalidDelay.valid, false);
  if (!invalidDelay.valid) assert.equal(invalidDelay.code, 'CHECKIN_DELAY_INVALID');

  const missingTime = validateScheduledCheckinInput(
    { title: 'Check-in', prompt: 'Ping', channel: 'telegram' },
    now
  );
  assert.equal(missingTime.valid, false);
  if (!missingTime.valid) assert.equal(missingTime.code, 'CHECKIN_SCHEDULE_TIME_REQUIRED');
});

test('formatCheckinMessage and tool declarations expose scheduleCheckIn cleanly', () => {
  const text = formatCheckinMessage({
    title: 'Deriv Demo Trade Review',
    prompt: 'Post your chart setup.',
  });
  assert.ok(text.includes('Deriv Demo Trade Review'));
  assert.ok(text.includes('Post your chart setup.'));

  assert.ok(GEMINI_TWIN_TOOLS.some((t) => t.name === 'scheduleCheckIn'));
  assert.ok(OPENAI_COMPATIBLE_TWIN_TOOLS.some((t) => t.function?.name === 'scheduleCheckIn'));
});
