import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  min: number;
  max: number;
  initial: number;
  /**
   * Which edge the drag handle sits on. Determines how pointer motion maps to width change:
   *  - 'left' (default): handle is on the LEFT edge of the sized element (typical for the right
   *    column of a two-column layout). Dragging the handle left makes the element wider.
   *  - 'right': handle is on the RIGHT edge (typical for the left column). Dragging right makes
   *    the element wider.
   */
  edge?: 'left' | 'right';
};

export function useResizableWidth(storageKey: string, options: Options) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved ? Number.parseInt(saved, 10) : NaN;
      if (Number.isFinite(parsed)) return clamp(parsed, options.min, options.max);
    } catch {
      // ignore
    }
    return options.initial;
  });

  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(width)); } catch { /* ignore quota */ }
  }, [storageKey, width]);

  const edge = options.edge ?? 'left';
  const startDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      // left-edge handle: dragging left grows the element; right-edge handle: dragging right grows it.
      const delta = edge === 'left' ? startX - ev.clientX : ev.clientX - startX;
      const next = clamp(startWidth + delta, options.min, options.max);
      setWidth(next);
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [options.min, options.max, edge]);

  return { width, startDrag };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
