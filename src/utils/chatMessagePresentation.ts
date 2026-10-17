export const AI_MESSAGE_PREVIEW_LIMIT = 1200;

export interface MessageContentView {
  content: string;
  canExpand: boolean;
  isExpanded: boolean;
}

/**
 * Keeps user-authored messages fully visible and collapses only completed,
 * long assistant responses. Streaming text is never hidden behind the preview.
 */
export function getMessageContentView(
  content: string,
  role: "user" | "assistant",
  expanded: boolean,
  isStreaming = false,
  previewLimit = AI_MESSAGE_PREVIEW_LIMIT,
): MessageContentView {
  const canExpand =
    role === "assistant" &&
    !isStreaming &&
    Number.isFinite(previewLimit) &&
    previewLimit > 0 &&
    content.length > previewLimit;

  const isExpanded = canExpand && expanded;
  const visibleContent = canExpand && !isExpanded
    ? `${content.slice(0, previewLimit).trimEnd()}…`
    : content;

  return {
    content: visibleContent,
    canExpand,
    isExpanded,
  };
}
