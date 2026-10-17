import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTelegramMode,
  isValidTelegramWebhookUrl,
  parseTelegramOwnerId,
  resolveTelegramMode,
  resolveTelegramOwnerId,
  resolveTelegramToken,
  resolveTelegramWebhookUrl,
  shouldAttemptTelegramStart,
} from '../server/services/telegramConfigService.ts';

test('environment Telegram token takes precedence over saved Settings token', () => {
  assert.equal(resolveTelegramToken(' environment-token-value ', 'saved-token-value'), 'environment-token-value');
  assert.equal(resolveTelegramToken('', 'saved-token-value'), 'saved-token-value');
  assert.equal(resolveTelegramToken('********', 'saved-token-value'), 'saved-token-value');
  assert.equal(resolveTelegramToken('', ''), '');
});

test('Telegram mode uses supported explicit configuration and rejects invalid environment values', () => {
  assert.equal(isTelegramMode('polling'), true);
  assert.equal(isTelegramMode('webhook'), true);
  assert.equal(isTelegramMode('polling-ish'), false);
  assert.equal(resolveTelegramMode('webhook', 'polling'), 'webhook');
  assert.equal(resolveTelegramMode('', 'webhook'), 'webhook');
  assert.equal(resolveTelegramMode(undefined, undefined), 'polling');
  assert.throws(() => resolveTelegramMode('webhhok', 'polling'), /INVALID_TELEGRAM_MODE/);
});

test('Telegram owner IDs accept only positive safe integers and do not silently override invalid environment configuration', () => {
  assert.equal(parseTelegramOwnerId('12345'), 12345);
  assert.equal(parseTelegramOwnerId('0'), null);
  assert.equal(parseTelegramOwnerId('-3'), null);
  assert.equal(parseTelegramOwnerId('not-an-id'), null);
  assert.equal(resolveTelegramOwnerId('12345', '99'), 12345);
  assert.equal(resolveTelegramOwnerId('', '99'), 99);
  assert.throws(() => resolveTelegramOwnerId('invalid', '99'), /INVALID_TELEGRAM_OWNER_ID/);
});

test('Telegram webhook URLs require HTTPS and reject credential-bearing or malformed URLs', () => {
  assert.equal(isValidTelegramWebhookUrl(''), true);
  assert.equal(isValidTelegramWebhookUrl('https://app.example.com/api/telegram/webhook'), true);
  assert.equal(isValidTelegramWebhookUrl('http://app.example.com/api/telegram/webhook'), false);
  assert.equal(isValidTelegramWebhookUrl('https://user:password@app.example.com/hook'), false);
  assert.equal(isValidTelegramWebhookUrl('not a URL'), false);
  assert.equal(resolveTelegramWebhookUrl('', 'https://app.example.com/hook'), 'https://app.example.com/hook');
});

test('saving an unchanged Telegram token retries startup only when the bot is stopped', () => {
  assert.equal(shouldAttemptTelegramStart(true, false, false), true);
  assert.equal(shouldAttemptTelegramStart(true, true, true), true);
  assert.equal(shouldAttemptTelegramStart(true, false, true), false);
  assert.equal(shouldAttemptTelegramStart(false, true, false), false);
});
