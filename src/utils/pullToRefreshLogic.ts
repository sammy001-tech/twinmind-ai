/**
 * Pure calculation and URL formatting logic for Mobile Pull-to-Refresh
 * Complies with AGENTS.md ZeroMock and Dynamic Resolution policies.
 */

/**
 * Calculates the damped pull distance given a raw vertical touch delta.
 * Employs a non-linear resistance curve so pulling feels natural,
 * matching native iOS and Android SwipeRefreshLayout physics.
 */
export function calculatePullDistance(
  deltaY: number,
  maxPullDistance: number = 95,
  dampingPower: number = 0.82,
): number {
  if (deltaY <= 0 || !Number.isFinite(deltaY)) {
    return 0;
  }
  const damped = Math.pow(deltaY, dampingPower) * 1.85;
  const clamped = Math.min(maxPullDistance, damped);
  return Math.round(clamped * 10) / 10;
}

/**
 * Evaluates whether the user pulled far enough to trigger the refresh action.
 */
export function isPullThresholdMet(
  pullDistance: number,
  threshold: number = 60,
): boolean {
  return Number.isFinite(pullDistance) && pullDistance >= threshold;
}

/**
 * Checks whether an element's scroll position permits starting a pull-to-refresh.
 * Pull-to-refresh must only engage when at the very top of the scroll container.
 */
export function canStartPull(scrollTop: number): boolean {
  return Number.isFinite(scrollTop) && scrollTop <= 0;
}

/**
 * Constructs a cache-busting URL with a timestamp query parameter.
 * This instructs the Android WebView / browser to bypass cached assets
 * and fetch the latest build from the live server.
 */
export function buildCacheBustReloadUrl(
  currentUrlStr: string,
  timestamp: number = Date.now(),
): string {
  try {
    const isAbsolute = currentUrlStr.startsWith('http://') || currentUrlStr.startsWith('https://');
    const base = isAbsolute ? undefined : 'https://app.local';
    const parsed = new URL(currentUrlStr, base);
    parsed.searchParams.set('_v', timestamp.toString());
    
    if (isAbsolute) {
      return parsed.toString();
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    const sep = currentUrlStr.includes('?') ? '&' : '?';
    return `${currentUrlStr}${sep}_v=${timestamp}`;
  }
}
