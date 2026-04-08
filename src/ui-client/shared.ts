export function renderSharedModule(): string {
  return String.raw`
import { api, copyToClipboard, els, esc, formatBytes, formatTimeRemaining, formDataObject, getGlobalEnvironment, optionMarkup, pretty, renderMeta, setBtnLoading, showLoading, toast } from '/assets/ui/runtime.js'
import { app } from '/assets/ui/state.js'
import { applyAccountKindVisibility, readSelectedValue, registerSubTabs, registerTabHandlers, setTab, updateEntityContext } from '/assets/ui/dom-utils.js'
import { getDefaultSelectedColumns, getSelectableAttributes, isSelectableAttribute, loadEntities, renderEntitySidebar, renderSelectedColumns, toggleColumn } from '/assets/ui/dataverse-shared.js'
import { highlightJson, renderResultTable } from '/assets/ui/render-utils.js'

export { api, app, applyAccountKindVisibility, copyToClipboard, els, esc, formatBytes, formatTimeRemaining, formDataObject, getDefaultSelectedColumns, getGlobalEnvironment, getSelectableAttributes, highlightJson, isSelectableAttribute, loadEntities, optionMarkup, pretty, readSelectedValue, registerSubTabs, registerTabHandlers, renderEntitySidebar, renderMeta, renderResultTable, renderSelectedColumns, setBtnLoading, setTab, showLoading, toast, toggleColumn, updateEntityContext }
export function showLastResponse() {}

`;
}
