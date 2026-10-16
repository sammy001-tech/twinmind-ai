import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatScrollState } from '../src/utils/chatScroll.ts';
import { normalizeDynamicPromptTemplates } from '../src/utils/dynamicPrompts.ts';
import { getReportedSpecialists } from '../src/utils/toolActivity.ts';

test('shows jump-to-latest only when the reader is away from the latest content', () => {
  const away = getChatScrollState({
    scrollHeight: 2400,
    scrollTop: 900,
    clientHeight: 600,
  });
  assert.equal(away.isAtLatest, false);
  assert.equal(away.shouldShowJumpToLatest, true);

  const nearLatest = getChatScrollState({
    scrollHeight: 2400,
    scrollTop: 1760,
    clientHeight: 600,
  });
  assert.equal(nearLatest.isAtLatest, true);
  assert.equal(nearLatest.shouldShowJumpToLatest, false);
});

test('does not show a jump control for content that does not overflow', () => {
  const state = getChatScrollState({
    scrollHeight: 480,
    scrollTop: 0,
    clientHeight: 600,
  });
  assert.equal(state.isAtLatest, true);
  assert.equal(state.shouldShowJumpToLatest, false);
});

test('does not invent specialist names when runtime details are missing or malformed', () => {
  assert.deepEqual(getReportedSpecialists(undefined), []);
  assert.deepEqual(getReportedSpecialists(null), []);
  assert.deepEqual(getReportedSpecialists(['', '  ', 4, null]), []);
});

test('retains only explicitly reported specialist names and removes duplicates', () => {
  assert.deepEqual(
    getReportedSpecialists(['Model Alpha', 'Model Alpha', ' Model Beta ', '']),
    ['Model Alpha', 'Model Beta'],
  );
});

test('does not synthesize suggested prompts for missing or malformed provider output', () => {
  assert.deepEqual(normalizeDynamicPromptTemplates(undefined), []);
  assert.deepEqual(normalizeDynamicPromptTemplates({ prompts: [] }), []);
  assert.deepEqual(
    normalizeDynamicPromptTemplates([
      null,
      { title: 'Missing prompt body' },
      { prompt: 'Missing title' },
      { title: ' ', prompt: 'Text' },
      { title: 'Title', prompt: ' ' },
    ]),
    [],
  );
});

test('preserves valid prompt text and optional metadata returned by the live source', () => {
  assert.deepEqual(
    normalizeDynamicPromptTemplates([
      {
        title: ' Context review ',
        prompt: ' Review current records ',
        category: ' Research ',
        description: ' Use stored context ',
        ignored: 'not part of the public prompt contract',
      },
    ]),
    [{
      title: 'Context review',
      prompt: 'Review current records',
      category: 'Research',
      description: 'Use stored context',
    }],
  );
});
