import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  calculatePullDistance,
  isPullThresholdMet,
  canStartPull,
  buildCacheBustReloadUrl,
} from '../utils/pullToRefreshLogic.ts';

interface PullToRefreshProps {
  children: React.ReactNode;
  onRefresh?: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  pullThreshold?: number;
  maxPullDistance?: number;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  children,
  onRefresh,
  disabled = false,
  className = '',
  pullThreshold = 65,
  maxPullDistance = 100,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTouching, setIsTouching] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const canPullRef = useRef<boolean>(false);
  const hasVibratedRef = useRef<boolean>(false);
  const activeScrollableRef = useRef<HTMLElement | null>(null);

  const isThresholdMet = isPullThresholdMet(pullDistance, pullThreshold);

  // Helper to find the scrollable container under or within the touched tree
  const findScrollableElement = (target: EventTarget | null): HTMLElement | null => {
    if (!target || !(target instanceof HTMLElement)) return null;
    let curr: HTMLElement | null = target;
    while (curr && curr !== containerRef.current) {
      const overflowY = window.getComputedStyle(curr).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && curr.scrollHeight > curr.clientHeight) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing || e.touches.length !== 1) return;

    const touch = e.touches[0];
    touchStartY.current = touch.clientY;
    touchStartX.current = touch.clientX;
    hasVibratedRef.current = false;

    // Detect the relevant scrollable ancestor / child
    const scrollable = findScrollableElement(e.target);
    activeScrollableRef.current = scrollable;

    // Check if the scrollable element is at the very top
    const scrollTop = scrollable ? scrollable.scrollTop : (window.scrollY || 0);
    canPullRef.current = canStartPull(scrollTop);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing || touchStartY.current === null || touchStartX.current === null) {
      return;
    }

    const touch = e.touches[0];
    const rawDeltaY = touch.clientY - touchStartY.current;
    const rawDeltaX = Math.abs(touch.clientX - touchStartX.current);

    // If user has scrolled down into content, cancel pull
    if (activeScrollableRef.current && activeScrollableRef.current.scrollTop > 0) {
      canPullRef.current = false;
      if (pullDistance > 0) setPullDistance(0);
      return;
    }

    // Only engage if at the top, pulling downward, and vertical movement dominates
    if (canPullRef.current && rawDeltaY > 5 && rawDeltaY > rawDeltaX * 1.2) {
      setIsTouching(true);
      const computedDistance = calculatePullDistance(rawDeltaY, maxPullDistance);
      setPullDistance(computedDistance);

      // Trigger a subtle haptic pulse when threshold is reached
      if (isPullThresholdMet(computedDistance, pullThreshold) && !hasVibratedRef.current) {
        hasVibratedRef.current = true;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(25);
          } catch {}
        }
      }

      // Prevent native overscroll bouncing when actively pulling down
      if (e.cancelable && computedDistance > 10) {
        e.preventDefault();
      }
    }
  };

  const executeRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPullDistance(52); // Keep indicator visible in spinning state

    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        // Default action: wait 300ms for user feedback then hard-reload with cache buster
        await new Promise((resolve) => setTimeout(resolve, 350));
        const reloadUrl = buildCacheBustReloadUrl(window.location.href);
        window.location.replace(reloadUrl);
      }
    } catch {
      // Fallback reload if onRefresh threw
      const reloadUrl = buildCacheBustReloadUrl(window.location.href);
      window.location.replace(reloadUrl);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 500);
    }
  }, [onRefresh]);

  const handleTouchEnd = () => {
    setIsTouching(false);
    touchStartY.current = null;
    touchStartX.current = null;
    canPullRef.current = false;

    if (isThresholdMet && !isRefreshing) {
      void executeRefresh();
    } else {
      setPullDistance(0);
    }
  };

  const handleTouchCancel = () => {
    setIsTouching(false);
    touchStartY.current = null;
    touchStartX.current = null;
    canPullRef.current = false;
    setPullDistance(0);
  };

  // Rotation degrees based on pull progress
  const rotationDegrees = Math.min(360, (pullDistance / pullThreshold) * 360);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className={`relative w-full h-full flex flex-col min-h-0 ${className}`}
    >
      {/* Floating Pull-to-Refresh Pill Indicator */}
      <div
        role="status"
        aria-live="polite"
        style={{
          transform: `translate3d(-50%, ${pullDistance > 0 || isRefreshing ? Math.max(14, pullDistance - 44) : -56}px, 0)`,
          opacity: pullDistance > 8 || isRefreshing ? 1 : 0,
          transition: isTouching ? 'opacity 0.15s ease' : 'all 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="pointer-events-none fixed left-1/2 top-14 z-50 flex items-center justify-center w-11 h-11 rounded-full bg-white dark:bg-[#25282c] border border-slate-200/90 dark:border-slate-700/80 shadow-2xl shadow-black/20 text-slate-800 dark:text-slate-100"
      >
        {isRefreshing ? (
          <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" />
        ) : (
          <RefreshCw
            className={`w-5 h-5 transition-colors ${
              isThresholdMet ? 'text-amber-500 scale-110' : 'text-slate-500 dark:text-slate-400'
            }`}
            style={{
              transform: `rotate(${rotationDegrees}deg)`,
              transition: isTouching ? 'color 0.15s, transform 0.05s' : 'all 0.2s',
            }}
          />
        )}
        <span className="sr-only">
          {isRefreshing
            ? 'Refreshing app...'
            : isThresholdMet
            ? 'Release to refresh'
            : 'Pull to refresh'}
        </span>
      </div>

      {children}
    </div>
  );
};
