export function createDiagnostic(level, code, message, extra = {}) {
    return { level, code, message, ...extra };
}
export function ok(data, diagnostics = []) {
    return { success: true, data, diagnostics };
}
export function fail(...diagnostics) {
    return { success: false, diagnostics };
}
