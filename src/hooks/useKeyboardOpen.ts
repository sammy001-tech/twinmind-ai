import { useEffect, useState } from 'react';

/**
 * Detects whether a mobile virtual/soft keyboard is likely open using VisualViewport
 * height compression alongside an active text input focus.
 */
export function useKeyboardOpen(): boolean {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const evaluate = () => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isTextFieldFocused = Boolean(
        activeEl &&
          (activeEl.tagName === 'TEXTAREA' ||
            (activeEl.tagName === 'INPUT' &&
              !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(
                (activeEl as HTMLInputElement).type || 'text',
              )) ||
            activeEl.isContentEditable),
      );

      const vv = window.visualViewport;
      if (!vv) {
        setIsKeyboardOpen(false);
        return;
      }

      const isNarrowViewport = window.innerWidth < 1024;
      const heightRatio = vv.height / Math.max(1, window.innerHeight);
      const compressedHeight = window.innerHeight - vv.height > 120 || heightRatio < 0.78;
      setIsKeyboardOpen(Boolean(isNarrowViewport && isTextFieldFocused && compressedHeight));
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', evaluate);
    window.addEventListener('resize', evaluate);
    document.addEventListener('focusin', evaluate);
    document.addEventListener('focusout', evaluate);

    return () => {
      vv?.removeEventListener('resize', evaluate);
      window.removeEventListener('resize', evaluate);
      document.removeEventListener('focusin', evaluate);
      document.removeEventListener('focusout', evaluate);
    };
  }, []);

  return isKeyboardOpen;
}
