import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAndroidBackAction, type BackOverlayId } from '../src/utils/mobileHistoryNav.ts';
import { formatMicrophoneError, resolveSupportedAudioMimeType } from '../src/utils/mediaPermissions.ts';
import { isFreshSignedPath, safeArtifactPath } from '../src/utils/artifactDownload.ts';
import { getDraftStorageKey } from '../src/utils/chatDrafts.ts';

function emptyOverlays(): Record<BackOverlayId, boolean> {
  return {
    'rules-drawer': false,
    'thread-drawer': false,
    'style-widget': false,
    'voice-modal': false,
    'custom-prompt-modal': false,
    'export-modal': false,
    'telegram-modal': false,
    'nickname-modal': false,
    'profile-modal': false,
    'decision-modal': false,
    'knowledge-modal': false,
    'settings-modal': false,
    'chat-search': false,
  };
}

test('resolveAndroidBackAction closes top-priority open overlay before switching tabs', () => {
  const overlays = emptyOverlays();
  overlays['thread-drawer'] = true;
  overlays['rules-drawer'] = true;

  const decision = resolveAndroidBackAction({
    openOverlays: overlays,
    activeTab: 'chat',
    tabHistory: ['home', 'chat'],
  });

  assert.deepEqual(decision, {
    action: 'close-overlay',
    overlayToClose: 'rules-drawer',
  });
});

test('resolveAndroidBackAction steps back through tab history and falls back to home before exiting', () => {
  const overlays = emptyOverlays();

  const stepFromSettings = resolveAndroidBackAction({
    openOverlays: overlays,
    activeTab: 'settings',
    tabHistory: ['home', 'chat'],
  });
  assert.deepEqual(stepFromSettings, {
    action: 'switch-tab',
    nextTab: 'chat',
  });

  const stepFromChatNoHistory = resolveAndroidBackAction({
    openOverlays: overlays,
    activeTab: 'chat',
    tabHistory: [],
  });
  assert.deepEqual(stepFromChatNoHistory, {
    action: 'switch-tab',
    nextTab: 'home',
  });

  const atRoot = resolveAndroidBackAction({
    openOverlays: overlays,
    activeTab: 'home',
    tabHistory: ['home'],
  });
  assert.deepEqual(atRoot, { action: 'at-root' });
});

test('resolveSupportedAudioMimeType probes candidates in order and handles unsupported WebViews', () => {
  const mp4Only = resolveSupportedAudioMimeType((mime) => mime === 'audio/mp4');
  assert.equal(mp4Only, 'audio/mp4');

  const noneSupported = resolveSupportedAudioMimeType(() => false);
  assert.equal(noneSupported, undefined);
});

test('formatMicrophoneError explains Android/AppMint permission and hardware states', () => {
  const denied = formatMicrophoneError(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  assert.match(denied, /Android Settings/i);
  assert.match(denied, /AppMint/i);

  const missingMic = formatMicrophoneError(Object.assign(new Error('No device'), { name: 'NotFoundError' }));
  assert.match(missingMic, /No working microphone/i);

  const busyMic = formatMicrophoneError(Object.assign(new Error('Device busy'), { name: 'NotReadableError' }));
  assert.match(busyMic, /another app/i);

  const unsupportedWebView = formatMicrophoneError(new TypeError('undefined'), {
    isSecureContext: true,
    hasGetUserMedia: false,
  });
  assert.match(unsupportedWebView, /getUserMedia unavailable/i);
});

test('safeArtifactPath and isFreshSignedPath validate signed artifact URLs strictly', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 120;
  const expiredExp = Math.floor(Date.now() / 1000) - 30;

  assert.equal(safeArtifactPath('https://evil.example/artifacts/foo.pdf'), null);
  assert.equal(safeArtifactPath('/artifacts/foo/bar.pdf'), null);

  const valid = `/artifacts/report.pdf?expires=${futureExp}&signature=abc123`;
  assert.equal(isFreshSignedPath(valid), true);

  const expired = `/artifacts/report.pdf?expires=${expiredExp}&signature=abc123`;
  assert.equal(isFreshSignedPath(expired), false);

  const unsigned = '/artifacts/report.pdf';
  assert.equal(isFreshSignedPath(unsigned), false);
});

test('getDraftStorageKey isolates drafts per thread and normalizes empty IDs', () => {
  assert.equal(getDraftStorageKey(null), 'twinmind_chat_draft_v1_default');
  assert.equal(getDraftStorageKey('   '), 'twinmind_chat_draft_v1_default');
  assert.equal(getDraftStorageKey('thread-42'), 'twinmind_chat_draft_v1_thread-42');
});
