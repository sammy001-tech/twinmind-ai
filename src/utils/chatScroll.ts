export interface ChatScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export interface ChatScrollState {
  distanceFromBottom: number;
  isAtLatest: boolean;
  shouldShowJumpToLatest: boolean;
}

/** Derive navigation state from the real scroll container. */
export function getChatScrollState({
  scrollHeight,
  scrollTop,
  clientHeight,
}: ChatScrollMetrics): ChatScrollState {
  const safeScrollHeight = Math.max(0, Number.isFinite(scrollHeight) ? scrollHeight : 0);
  const safeScrollTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const safeClientHeight = Math.max(0, Number.isFinite(clientHeight) ? clientHeight : 0);
  const distanceFromBottom = Math.max(
    0,
    safeScrollHeight - safeScrollTop - safeClientHeight,
  );
  const tolerance = Math.max(72, Math.min(144, safeClientHeight * 0.12));
  const isAtLatest =
    distanceFromBottom <= tolerance || safeScrollHeight <= safeClientHeight + tolerance;

  return {
    distanceFromBottom,
    isAtLatest,
    shouldShowJumpToLatest:
      safeScrollHeight > safeClientHeight + tolerance && !isAtLatest,
  };
}
