import type { NavigationTab } from '../components/BottomNav.tsx';

export type BackOverlayId =
  | 'rules-drawer'
  | 'thread-drawer'
  | 'style-widget'
  | 'voice-modal'
  | 'custom-prompt-modal'
  | 'export-modal'
  | 'telegram-modal'
  | 'nickname-modal'
  | 'profile-modal'
  | 'decision-modal'
  | 'knowledge-modal'
  | 'settings-modal'
  | 'chat-search';

export interface MobileNavBackDecision {
  action: 'close-overlay' | 'switch-tab' | 'at-root';
  overlayToClose?: BackOverlayId;
  nextTab?: NavigationTab;
}

const OVERLAY_PRIORITY: BackOverlayId[] = [
  'rules-drawer',
  'thread-drawer',
  'voice-modal',
  'export-modal',
  'custom-prompt-modal',
  'style-widget',
  'telegram-modal',
  'nickname-modal',
  'profile-modal',
  'decision-modal',
  'knowledge-modal',
  'settings-modal',
  'chat-search',
];

export function resolveAndroidBackAction(params: {
  openOverlays: Record<BackOverlayId, boolean>;
  activeTab: NavigationTab;
  tabHistory: NavigationTab[];
}): MobileNavBackDecision {
  for (const overlayId of OVERLAY_PRIORITY) {
    if (params.openOverlays[overlayId]) {
      return { action: 'close-overlay', overlayToClose: overlayId };
    }
  }

  for (let i = params.tabHistory.length - 1; i >= 0; i--) {
    const candidate = params.tabHistory[i];
    if (candidate && candidate !== params.activeTab) {
      return { action: 'switch-tab', nextTab: candidate };
    }
  }

  if (params.activeTab !== 'home') {
    return { action: 'switch-tab', nextTab: 'home' };
  }

  return { action: 'at-root' };
}
