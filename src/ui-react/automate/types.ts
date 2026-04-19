import type { FlowValidationItem } from '../automate-data.js';
import type { FlowAnalysisOutlineItem } from '../ui-types.js';

export type AutomateSubTab = 'definition' | 'runs' | 'outline';
export type FlowOperation = 'reload' | 'check-errors' | 'check-warnings' | 'save' | null;

export type FlowEditorHandle = {
  format: () => string | null;
  revealRange: (from?: number, to?: number) => void;
  revealText: (needle?: string) => void;
};

export type FlowProblem = {
  source: 'local' | 'service';
  level: 'error' | 'warning' | 'info';
  code?: string;
  message: string;
  from?: number;
  to?: number;
  path?: string;
  actionName?: string;
  validationItem?: FlowValidationItem;
};

export type FlowActionEditTarget = {
  item: FlowAnalysisOutlineItem;
  name: string;
  value: Record<string, unknown>;
  from: number;
  to: number;
  replaceMode: 'property' | 'value';
  canRename: boolean;
};
