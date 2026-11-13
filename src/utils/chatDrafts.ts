const DRAFT_PREFIX = 'twinmind_chat_draft_v1_';

export function getDraftStorageKey(threadId?: string | null): string {
  const normalized = typeof threadId === 'string' && threadId.trim() ? threadId.trim() : 'default';
  return `${DRAFT_PREFIX}${normalized}`;
}

export function loadChatDraft(threadId?: string | null): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(getDraftStorageKey(threadId)) || '';
  } catch {
    return '';
  }
}

export function saveChatDraft(threadId: string | null | undefined, content: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getDraftStorageKey(threadId);
    if (!content) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, content);
    }
  } catch {
    // Ignore storage quota or restricted-WebView errors
  }
}

export function clearChatDraft(threadId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getDraftStorageKey(threadId));
  } catch {
    // Ignore storage errors
  }
}
