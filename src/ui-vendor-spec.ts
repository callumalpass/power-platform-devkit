export const UI_VENDOR_SPECIFIERS = [
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-xml',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/xml',
  '@marijn/find-cluster-break',
  '@replit/codemirror-vim',
  'crelt',
  'style-mod',
  'w3c-keyname',
] as const;

export function createUiVendorImportMap(): Record<string, string> {
  return Object.fromEntries(UI_VENDOR_SPECIFIERS.map((specifier) => [specifier, `/assets/vendor/${specifier}`]));
}
