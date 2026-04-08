export function renderStateModule(): string {
  return String.raw`
export const state = {
  shell: {
    payload: null,
    currentLoginJobId: null
  },
  dataverse: {
    entities: [],
    entitiesEnvironment: null,
    currentEntity: null,
    currentEntityDetail: null,
    currentRecordPreview: null,
    selectedColumns: []
  }
}

export function setShellPayload(payload) {
  state.shell.payload = payload
}

export function setCurrentLoginJobId(jobId) {
  state.shell.currentLoginJobId = jobId || null
}

export function getCurrentLoginJobId() {
  return state.shell.currentLoginJobId
}

export function getShellPayload() {
  return state.shell.payload
}

export function getDataverseState() {
  return state.dataverse
}

export function clearDataverseSelection() {
  state.dataverse.currentEntity = null
  state.dataverse.currentEntityDetail = null
  state.dataverse.currentRecordPreview = null
  state.dataverse.selectedColumns = []
}

export function setEntitiesForEnvironment(environment, entities) {
  state.dataverse.entitiesEnvironment = environment || null
  state.dataverse.entities = Array.isArray(entities) ? entities : []
  clearDataverseSelection()
}

export function setCurrentEntity(entity) {
  state.dataverse.currentEntity = entity || null
}

export function setCurrentEntityDetail(detail) {
  state.dataverse.currentEntityDetail = detail || null
}

export function setCurrentRecordPreview(preview) {
  state.dataverse.currentRecordPreview = preview || null
}

export function setSelectedColumns(columns) {
  state.dataverse.selectedColumns = Array.isArray(columns) ? columns.slice() : []
}

export function clearSelectedColumns() {
  state.dataverse.selectedColumns = []
}

export function toggleSelectedColumn(logicalName) {
  const idx = state.dataverse.selectedColumns.indexOf(logicalName)
  if (idx >= 0) state.dataverse.selectedColumns.splice(idx, 1)
  else state.dataverse.selectedColumns.push(logicalName)
}

export async function ensureEntitiesLoaded(environment, loader) {
  if (!environment) return getDataverseState().entities
  if (state.dataverse.entitiesEnvironment === environment && state.dataverse.entities.length) {
    return state.dataverse.entities
  }
  const entities = await loader(environment)
  setEntitiesForEnvironment(environment, entities)
  return entities
}

export const app = {
  get state() { return state.shell.payload },
  set state(value) { setShellPayload(value) },
  get currentLoginJobId() { return state.shell.currentLoginJobId },
  set currentLoginJobId(value) { setCurrentLoginJobId(value) },
  get entities() { return state.dataverse.entities },
  set entities(value) { state.dataverse.entities = Array.isArray(value) ? value : [] },
  get currentEntity() { return state.dataverse.currentEntity },
  set currentEntity(value) { setCurrentEntity(value) },
  get currentEntityDetail() { return state.dataverse.currentEntityDetail },
  set currentEntityDetail(value) { setCurrentEntityDetail(value) },
  get currentRecordPreview() { return state.dataverse.currentRecordPreview },
  set currentRecordPreview(value) { setCurrentRecordPreview(value) },
  get entitiesEnvironment() { return state.dataverse.entitiesEnvironment },
  set entitiesEnvironment(value) { state.dataverse.entitiesEnvironment = value || null },
  get selectedColumns() { return state.dataverse.selectedColumns },
  set selectedColumns(value) { setSelectedColumns(value) }
}
`;
}
