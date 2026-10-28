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
 * Dynamically determines presentation content view for any message.
 * Purges all hardcoded role checks: any message (user, assistant, or system) is evaluated
 * dynamically based on runtime content length, line structure, and active parameters.
 */
export function getMessageContentView(
  content: string,
  _role?: string,
  expanded = false,
  isStreaming = false,
  customLimit?: number,
): MessageContentView {
  const previewLimit = Number.isFinite(customLimit) && customLimit! > 0
    ? customLimit!
    : DEFAULT_DYNAMIC_PREVIEW_LIMIT;

  const lines = content.split('\n');
  const exceedsLineThreshold = lines.length > DEFAULT_DYNAMIC_MAX_LINES;
  const exceedsCharThreshold = content.length > previewLimit;

  // Dynamically evaluate expansion capability without role discrimination
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
