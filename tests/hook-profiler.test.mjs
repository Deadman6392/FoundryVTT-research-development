import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHookProfiler, BEFORE_PROFILER } from "../modules/performance-triage/scripts/lib/hook-profiler.mjs";
import { createMockHooks } from "./helpers/foundry-mock.mjs";
import { registerListener, registerOnce } from "./fixtures/modules/fake-module/register.mjs";

const SELF = "module:performance-triage";
const ORIGIN = "http://localhost:30000";

function busy(ms) {
  const end = performance.now() + ms;
  while ( performance.now() < end ) { /* spin */ }
}

// A fresh Hooks class per test so wrappers never leak between tests
let Hooks;
beforeEach(() => {
  Hooks = createMockHooks();
});

test("listeners are attributed to the registering package and timed", () => {
  const profiler = createHookProfiler({ hooks: Hooks, selfKey: SELF, origin: ORIGIN });
  assert.ok(profiler.install());
  registerListener(Hooks, "updateActor", () => busy(5));
  Hooks.callAll("updateActor");
  Hooks.callAll("updateActor");
  const stats = profiler.stats();
  const row = stats.listeners.find(l => l.hook === "updateActor");
  assert.equal(row.pkg, "module:fake-module");
  assert.equal(row.calls, 2);
  assert.ok(row.self >= 9, `self ${row.self}`);
  assert.equal(stats.packages[0].pkg, "module:fake-module");
});

test("nested hooks report exclusive self time", () => {
  const profiler = createHookProfiler({ hooks: Hooks, selfKey: SELF, origin: ORIGIN });
  profiler.install();
  registerListener(Hooks, "outer", () => {
    busy(2);
    Hooks.callAll("inner");
  });
  registerListener(Hooks, "inner", () => busy(10));
  Hooks.callAll("outer");
  const rows = Object.fromEntries(profiler.stats().listeners.map(l => [l.hook, l]));
  assert.ok(rows.outer.total >= 12);
  assert.ok(rows.outer.self < rows.outer.total - 9, `outer self ${rows.outer.self} should exclude inner ${rows.inner.total}`);
  assert.ok(rows.inner.self >= 10);
});

test("return values, once semantics and off() by function keep working", () => {
  const profiler = createHookProfiler({ hooks: Hooks, selfKey: SELF, origin: ORIGIN });
  profiler.install();
  let calls = 0;
  const veto = () => false;
  const counter = () => { calls++; };
  registerListener(Hooks, "preUpdate", veto);
  registerListener(Hooks, "preUpdate", counter);
  assert.equal(Hooks.call("preUpdate"), false, "a listener returning false still stops Hooks.call");
  assert.equal(calls, 0);

  Hooks.off("preUpdate", veto);
  assert.equal(Hooks.call("preUpdate"), true, "off() with the original function removed the wrapped listener");
  assert.equal(calls, 1);

  let onceCalls = 0;
  registerOnce(Hooks, "ready", () => onceCalls++);
  Hooks.callAll("ready");
  Hooks.callAll("ready");
  assert.equal(onceCalls, 1);
  assert.equal(profiler.stats().listeners.find(l => l.hook === "ready").pkg, "module:fake-module");
});

test("listeners registered before install are still timed", () => {
  Hooks.on("renderChatMessageHTML", () => busy(1));
  const profiler = createHookProfiler({ hooks: Hooks, selfKey: SELF, origin: ORIGIN });
  profiler.install();
  Hooks.callAll("renderChatMessageHTML");
  const row = profiler.stats().listeners.find(l => l.hook === "renderChatMessageHTML");
  assert.equal(row.pkg, BEFORE_PROFILER);
  assert.equal(row.calls, 1);
});

test("a listener that throws is still recorded and the error propagates", () => {
  const profiler = createHookProfiler({ hooks: Hooks, selfKey: SELF, origin: ORIGIN });
  profiler.install();
  registerListener(Hooks, "boom", () => { throw new Error("listener failed"); });
  assert.throws(() => Hooks.callAll("boom"), /listener failed/);
  registerListener(Hooks, "after", () => {});
  Hooks.callAll("after");
  const after = profiler.stats().listeners.find(l => l.hook === "after");
  assert.ok(after.self >= 0, "timing stack recovered after the exception");
});

test("install refuses gracefully when Hooks is frozen", () => {
  const Frozen = Object.freeze(createMockHooks());
  const profiler = createHookProfiler({ hooks: Frozen, selfKey: SELF, origin: ORIGIN });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(profiler.install(), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(profiler.installed, false);
});
