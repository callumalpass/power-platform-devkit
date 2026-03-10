import type { CanvasControlCatalogEntry } from './control-catalog';

export interface CanvasStudioInsertPlanCover {
  kind: 'cover';
  reason: string;
}

export interface CanvasStudioInsertPlanAdd {
  kind: 'add';
  template: string;
  variant?: string;
  composite?: boolean;
}

export type CanvasStudioInsertPlan = CanvasStudioInsertPlanCover | CanvasStudioInsertPlanAdd;

const STUDIO_INSERT_PLAN: Readonly<Record<string, CanvasStudioInsertPlan>> = {
  'classic/3d object': { kind: 'add', template: 'ViewIn3D' },
  'classic/add picture': { kind: 'add', template: 'AddMediaWithImage', composite: true },
  'classic/address input': { kind: 'add', template: 'AddressInput' },
  'classic/attachments': { kind: 'add', template: 'attachments' },
  'classic/audio': { kind: 'add', template: 'audioPlayback' },
  'classic/barcode reader': { kind: 'add', template: 'BarcodeReader' },
  'classic/barcode scanner': { kind: 'add', template: 'barcodeScanner' },
  'classic/button': { kind: 'add', template: 'button' },
  'classic/camera': { kind: 'add', template: 'camera' },
  'classic/card': { kind: 'add', template: 'typedDataCard' },
  'classic/check box': { kind: 'add', template: 'checkbox' },
  'classic/column': { kind: 'add', template: 'typedDataCard' },
  'classic/column chart': { kind: 'add', template: 'CompositeColumnChart', composite: true },
  'classic/combo box': { kind: 'add', template: 'combobox' },
  'classic/container': { kind: 'add', template: 'groupContainer', variant: 'ManualLayout' },
  'classic/data table': { kind: 'add', template: 'dataTable' },
  'classic/date picker': { kind: 'add', template: 'datepicker' },
  'classic/display and edit form': { kind: 'cover', reason: 'covered-by-edit-and-display-form' },
  'classic/display form': { kind: 'add', template: 'formViewer' },
  'classic/drop down': { kind: 'add', template: 'dropdown' },
  'classic/edit form': { kind: 'add', template: 'form' },
  'classic/export': { kind: 'add', template: 'export' },
  'classic/gallery': {
    kind: 'add',
    template: 'gallery',
    variant: 'BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0',
  },
  'classic/grid container': { kind: 'add', template: 'groupContainer', variant: 'GridLayoutContainer' },
  'classic/horizontal container': {
    kind: 'add',
    template: 'groupContainer',
    variant: 'HorizontalAutoLayoutContainer',
  },
  'classic/html text': { kind: 'add', template: 'htmlViewer' },
  'classic/icon': { kind: 'add', template: 'icon' },
  'classic/image': { kind: 'add', template: 'image' },
  'classic/import': { kind: 'add', template: 'import' },
  'classic/label': { kind: 'add', template: 'label' },
  'classic/line chart': { kind: 'add', template: 'CompositeLineChart', composite: true },
  'classic/list box': { kind: 'add', template: 'listbox' },
  'classic/map': { kind: 'add', template: 'Map' },
  'classic/measuring camera': { kind: 'add', template: 'MeasureInMR' },
  'classic/microphone': { kind: 'add', template: 'microphone' },
  'classic/pdf viewer': { kind: 'add', template: 'pdfViewer' },
  'classic/pen input': { kind: 'add', template: 'inkControl' },
  'classic/pie chart': { kind: 'add', template: 'CompositePieChart', composite: true },
  'classic/power bi tile': { kind: 'add', template: 'powerbi' },
  'classic/radio': { kind: 'add', template: 'radio' },
  'classic/rating': { kind: 'add', template: 'rating' },
  'classic/rich text editor': { kind: 'add', template: 'richTextEditor' },
  'classic/screen': { kind: 'cover', reason: 'covered-by-baseline-screen1' },
  'classic/shape': { kind: 'add', template: 'rectangle' },
  'classic/slider': { kind: 'add', template: 'slider' },
  'classic/stream video': { kind: 'add', template: 'PowerApps_CoreControls_StreamVideo' },
  'classic/text input': { kind: 'add', template: 'text' },
  'classic/timer': { kind: 'add', template: 'timer' },
  'classic/toggle': { kind: 'add', template: 'toggleSwitch' },
  'classic/vertical container': {
    kind: 'add',
    template: 'groupContainer',
    variant: 'VerticalAutoLayoutContainer',
  },
  'classic/video': { kind: 'add', template: 'videoPlayback' },
  'classic/view in mr': { kind: 'add', template: 'ViewInMR' },
  'classic/view shape in mr': { kind: 'add', template: 'ViewShapeInMR' },
  'classic/web barcode scanner': { kind: 'add', template: 'barcodeScanner' },

  'modern/avatar': { kind: 'add', template: 'PowerApps_CoreControls_Avatar' },
  'modern/badge': { kind: 'add', template: 'PowerApps_CoreControls_BadgeCanvas' },
  'modern/button': { kind: 'add', template: 'PowerApps_CoreControls_ButtonCanvas' },
  'modern/card': { kind: 'add', template: 'modernCard' },
  'modern/checkbox': { kind: 'add', template: 'PowerApps_CoreControls_CheckboxCanvas' },
  'modern/combobox': { kind: 'add', template: 'modernCombobox' },
  'modern/copilot answer': { kind: 'add', template: 'CopilotAnswer' },
  'modern/date picker': { kind: 'add', template: 'modernDatePicker' },
  'modern/dropdown': { kind: 'add', template: 'PowerApps_CoreControls_DropdownCanvas' },
  'modern/header': { kind: 'add', template: 'Header' },
  'modern/info button': { kind: 'add', template: 'modernInformationButton' },
  'modern/link': { kind: 'add', template: 'modernLink' },
  'modern/number input': { kind: 'add', template: 'modernNumberInput' },
  'modern/progress bar': { kind: 'add', template: 'PowerApps_CoreControls_Progress' },
  'modern/radio group': { kind: 'add', template: 'modernRadio' },
  'modern/slider': { kind: 'add', template: 'PowerApps_CoreControls_Slider' },
  'modern/spinner': { kind: 'add', template: 'PowerApps_CoreControls_Spinner' },
  'modern/stream': { kind: 'add', template: 'PowerApps_CoreControls_StreamVideo' },
  'modern/table': { kind: 'add', template: 'PowerAppsOneGrid' },
  'modern/tabs or tab list': { kind: 'add', template: 'modernTabList' },
  'modern/text': { kind: 'add', template: 'modernText' },
  'modern/text input': { kind: 'add', template: 'modernTextInput' },
  'modern/toggle': { kind: 'add', template: 'PowerApps_CoreControls_Toggle' },
};

export function makeCanvasStudioInsertPlanKey(family: CanvasControlCatalogEntry['family'], name: string): string {
  return `${family}/${normalizeLabel(name)}`;
}

export function resolveCanvasControlCatalogStudioInsertPlan(
  entry: Pick<CanvasControlCatalogEntry, 'family' | 'name'>
): CanvasStudioInsertPlan | undefined {
  return STUDIO_INSERT_PLAN[makeCanvasStudioInsertPlanKey(entry.family, entry.name)];
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
