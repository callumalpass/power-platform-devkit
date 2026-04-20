export function isMonacoKeyboardEvent(event: KeyboardEvent): boolean {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.closest('.monaco-editor, .monaco-diff-editor')) {
    return true;
  }
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const item of path) {
    if (item instanceof HTMLElement && item.closest('.monaco-editor, .monaco-diff-editor')) return true;
  }
  const target = event.target;
  return target instanceof HTMLElement && Boolean(target.closest('.monaco-editor, .monaco-diff-editor'));
}
