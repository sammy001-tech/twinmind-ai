import { useEffect, useRef } from 'react';
import type { NavigationTab } from '../components/BottomNav.tsx';
import { BackOverlayId, resolveAndroidBackAction } from '../utils/mobileHistoryNav.ts';

interface UseAndroidBackNavigationOptions {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  openOverlays: Record<BackOverlayId, boolean>;
  closeOverlay: (overlayId: BackOverlayId) => void;
}

/**
 * Keeps browser/WebView history synced with TwinMind's modals, drawers, and tabs
 * so Android hardware Back button / edge-swipe navigates within the app instead of
 * exiting the APK immediately.
 */
export function useAndroidBackNavigation({
  activeTab,
  setActiveTab,
  openOverlays,
  closeOverlay,
}: UseAndroidBackNavigationOptions): void {
  const tabHistoryRef = useRef<NavigationTab[]>(['home']);
  const isHandlingPopStateRef = useRef(false);
  const pushedSentinelRef = useRef(false);

  const latestRef = useRef({ activeTab, openOverlays, closeOverlay, setActiveTab });
  latestRef.current = { activeTab, openOverlays, closeOverlay, setActiveTab };

  const hasAnyOverlayOpen = Object.values(openOverlays).some(Boolean);
  const needsHistorySentinel = hasAnyOverlayOpen || activeTab !== 'home';

  useEffect(() => {
    const history = tabHistoryRef.current;
    if (history[history.length - 1] !== activeTab) {
      history.push(activeTab);
      if (history.length > 20) {
        tabHistoryRef.current = history.slice(-20);
      }
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (needsHistorySentinel && !pushedSentinelRef.current && !isHandlingPopStateRef.current) {
      try {
        window.history.pushState({ twinmindShellSentinel: true }, '');
        pushedSentinelRef.current = true;
      } catch {
        // Ignore restricted history APIs
      }
    }
  }, [needsHistorySentinel, activeTab, hasAnyOverlayOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      pushedSentinelRef.current = false;
      const current = latestRef.current;
      const decision = resolveAndroidBackAction({
        openOverlays: current.openOverlays,
        activeTab: current.activeTab,
        tabHistory: tabHistoryRef.current.slice(0, -1),
      });

      if (decision.action === 'at-root') {
        return;
      }

      isHandlingPopStateRef.current = true;
      try {
        if (decision.action === 'close-overlay' && decision.overlayToClose) {
          current.closeOverlay(decision.overlayToClose);
        } else if (decision.action === 'switch-tab' && decision.nextTab) {
          tabHistoryRef.current = tabHistoryRef.current.slice(0, -1);
          current.setActiveTab(decision.nextTab);
        }

        // Re-arm sentinel if another overlay or non-home tab remains active after stepping back
        window.setTimeout(() => {
          const updated = latestRef.current;
          const stillActive =
            Object.values(updated.openOverlays).some(Boolean) || updated.activeTab !== 'home';
          if (stillActive && !pushedSentinelRef.current) {
            try {
              window.history.pushState({ twinmindShellSentinel: true }, '');
              pushedSentinelRef.current = true;
            } catch {
              // Ignore
            }
          }
          isHandlingPopStateRef.current = false;
        }, 0);
      } catch {
        isHandlingPopStateRef.current = false;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
}
