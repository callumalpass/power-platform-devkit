// Must be imported before any `monaco-editor` module so that when Monaco
// checks `self.MonacoEnvironment`, our stub is already in place. Monaco's
// full language workers aren't bundled here (CLI-tool context doesn't need
// rich diagnostics), so getWorker returns an inline noop worker — enough to
// satisfy Monaco's init path without throwing the "Could not create web
// worker(s)" warning that spams the console.

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker?: (moduleId: string, label: string) => Worker };
  }
}

if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_moduleId: string, _label: string): Worker {
      const noop = 'self.onmessage=function(){};';
      const url = URL.createObjectURL(new Blob([noop], { type: 'application/javascript' }));
      return new Worker(url);
    }
  };
}

export {};
