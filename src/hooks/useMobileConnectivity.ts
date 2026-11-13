import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch.ts';

export type ConnectivityState = 'online' | 'offline' | 'server-unreachable';

export interface MobileConnectivityStatus {
  state: ConnectivityState;
  isChecking: boolean;
  lastError: string | null;
  checkServerHealth: () => Promise<boolean>;
  reportNetworkFailure: (reason?: string) => void;
  clearNetworkFailure: () => void;
}

export function useMobileConnectivity(): MobileConnectivityStatus {
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );
  const [serverUnreachableReason, setServerUnreachableReason] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const checkingRef = useRef(false);

  const checkServerHealth = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setIsBrowserOnline(false);
      return false;
    }
    if (checkingRef.current) return false;
    checkingRef.current = true;
    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await apiFetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) {
          setServerUnreachableReason(`Server health check returned HTTP ${res.status}.`);
          return false;
        }
        setServerUnreachableReason(null);
        return true;
      } finally {
        window.clearTimeout(timeout);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Server took too long to respond (may be waking up).'
          : 'Unable to reach TwinMind server.';
      setServerUnreachableReason(msg);
      return false;
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsBrowserOnline(true);
      void checkServerHealth();
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false && serverUnreachableReason) {
        void checkServerHealth();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkServerHealth, serverUnreachableReason]);

  const reportNetworkFailure = useCallback((reason?: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setIsBrowserOnline(false);
      return;
    }
    setServerUnreachableReason(
      reason || 'Connection interrupted while communicating with TwinMind server.',
    );
  }, []);

  const clearNetworkFailure = useCallback(() => {
    setServerUnreachableReason(null);
  }, []);

  const state: ConnectivityState = !isBrowserOnline
    ? 'offline'
    : serverUnreachableReason
      ? 'server-unreachable'
      : 'online';

  return {
    state,
    isChecking,
    lastError: !isBrowserOnline
      ? 'Your phone is offline. Drafts are saved locally; reconnect to send.'
      : serverUnreachableReason,
    checkServerHealth,
    reportNetworkFailure,
    clearNetworkFailure,
  };
}
