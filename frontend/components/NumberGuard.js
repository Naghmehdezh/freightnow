'use client';
import { useEffect } from 'react';

// Number fields with a minimum of 0 or more (weights, sizes, pieces, money) can't take a minus
// sign: the browser's `min` only limits the arrow keys, so typing or pasting "-5" got through.
// Applies app-wide to any <input type="number" min="…"> whose minimum isn't negative.
function nonNegative(el) {
  if (!(el instanceof HTMLInputElement) || el.type !== 'number') return false;
  const min = el.getAttribute('min');
  return min !== null && Number(min) >= 0;
}

export default function NumberGuard() {
  useEffect(() => {
    const onKeyDown = e => {
      if (nonNegative(e.target) && ['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
    };
    const onPaste = e => {
      if (!nonNegative(e.target)) return;
      const text = e.clipboardData?.getData('text') || '';
      if (/[-+eE]/.test(text)) e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, []);
  return null;
}
