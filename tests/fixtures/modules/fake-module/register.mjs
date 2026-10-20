// Stands in for a third-party module: its file path contains /modules/fake-module/ so stack attribution can find it.
export function registerListener(hooks, hook, fn) {
  return hooks.on(hook, fn);
}

export function registerOnce(hooks, hook, fn) {
  return hooks.once(hook, fn);
}
