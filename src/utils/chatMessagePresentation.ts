export const DEFAULT_DYNAMIC_PREVIEW_LIMIT = 300;
export const DEFAULT_DYNAMIC_MAX_LINES = 5;

// Backward-compatibility aliases for legacy imports
export const AI_MESSAGE_PREVIEW_LIMIT = DEFAULT_DYNAMIC_PREVIEW_LIMIT;
export const USER_MESSAGE_PREVIEW_LIMIT = DEFAULT_DYNAMIC_PREVIEW_LIMIT;

export interface MessageContentView {
  content: string;
  canExpand: boolean;
  isExpanded: boolean;
}

export interface PresentationOptions {
  channel?: 'web' | 'telegram' | 'whatsapp';
  customLimit?: number;
}

/**
 * Finds a safe cut position that does not break in the middle of a LaTeX math block ($$ or $)
 */
export function findSafeMathSliceIndex(text: string, limit: number): number {
  if (text.length <= limit) return text.length;

  let sliceIndex = limit;

  // Check if we are inside a $$ ... $$ block
  const beforeText = text.slice(0, sliceIndex);
  const doubleDollarCount = (beforeText.match(/\$\$/g) || []).length;
  if (doubleDollarCount % 2 === 1) {
    const closingIndex = text.indexOf('$$', sliceIndex);
    if (closingIndex !== -1) {
      sliceIndex = closingIndex + 2;
    }
  } else {
    const singleDollarCount = (beforeText.replace(/\$\$/g, '').match(/\$/g) || []).length;
    if (singleDollarCount % 2 === 1) {
      const closingIndex = text.indexOf('$', sliceIndex);
      if (closingIndex !== -1) {
        sliceIndex = closingIndex + 1;
      }
    }
  }

  return sliceIndex;
}

/**
 * Determines presentation content view for a message based on channel and content structure:
 * - On Web theme: Assistant messages NEVER collapse (providing full, continuous reading canvas).
 *   User messages on Web (especially on mobile screens) DO collapse when long, displaying
 *   the soft ice-blue gradient fade and blue 'Show more' / 'Show less' chevron toggle.
 * - On Telegram & WhatsApp: Both user and assistant messages collapse when long to maintain
 *   compact mobile messaging bubbles.
 * - Streaming text is never hidden behind a preview.
 */
export function getMessageContentView(
  content: string,
  role?: string,
  expanded = false,
  isStreaming = false,
  options?: number | PresentationOptions,
): MessageContentView {
  const customLimit = typeof options === 'number' ? options : options?.customLimit;
  const channel = typeof options === 'object' ? options?.channel : undefined;

  // Rule 1: On Web theme, assistant responses always remain fully expanded without truncation
  if (channel === 'web' && role === 'assistant') {
    return {
      content,
      canExpand: false,
      isExpanded: false,
    };
  }

  const previewLimit = Number.isFinite(customLimit) && customLimit! > 0
    ? customLimit!
    : DEFAULT_DYNAMIC_PREVIEW_LIMIT;

  const lines = content.split('\n');
  const exceedsLineThreshold = lines.length > DEFAULT_DYNAMIC_MAX_LINES;
  const exceedsCharThreshold = content.length > previewLimit;

  // Evaluates expansion capability: true when not streaming and threshold is exceeded
  const canExpand = !isStreaming && (exceedsCharThreshold || exceedsLineThreshold);
  const isExpanded = canExpand && expanded;

  let visibleContent = content;
  if (canExpand && !isExpanded) {
    if (exceedsLineThreshold && !exceedsCharThreshold) {
      const slicedLines = lines.slice(0, DEFAULT_DYNAMIC_MAX_LINES).join('\n');
      visibleContent = `${slicedLines.trimEnd()}…`;
    } else {
      const cutIndex = findSafeMathSliceIndex(content, previewLimit);
      if (cutIndex < content.length) {
        visibleContent = `${content.slice(0, cutIndex).trimEnd()}…`;
      }
    }
  }

  return {
    content: visibleContent,
    canExpand,
    isExpanded,
  };
}
