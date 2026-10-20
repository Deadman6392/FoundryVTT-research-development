/**
 * Optional CPU sampling using the JS Self-Profiling API (Chromium browsers and the Foundry desktop app).
 *
 * The browser only allows it when the game page is served with the response header `Document-Policy: js-profiling`,
 * which Foundry's own server does not send; a reverse proxy can add it (see docs/hosting.md). When available, it
 * attributes real CPU time to packages, including work inside libWrapper wrappers and event handlers that the hook
 * profiler cannot see. Sampling every 10 ms costs little while recording and nothing otherwise.
 */
import { telemetry } from "./telemetry.mjs";
import { analyzeTrace } from "./lib/aggregate.mjs";

const SAMPLE_INTERVAL = 10;

/** @returns {{available: boolean, reason?: "unsupported"|"policy"}} */
export function samplerSupport() {
  if ( typeof globalThis.Profiler !== "function" ) return { available: false, reason: "unsupported" };
  try {
    const probe = new Profiler({ sampleInterval: SAMPLE_INTERVAL, maxBufferSize: 10 });
    probe.stop();
    return { available: true };
  } catch {
    return { available: false, reason: "policy" };
  }
}

export async function recordProfile(seconds = 20) {
  const profiler = new Profiler({
    sampleInterval: SAMPLE_INTERVAL,
    maxBufferSize: Math.ceil((seconds * 1000) / SAMPLE_INTERVAL) + 1000
  });
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const trace = await profiler.stop();
  const result = analyzeTrace(trace, location.origin, SAMPLE_INTERVAL);
  result.seconds = seconds;
  result.recordedAt = new Date().toISOString();
  return telemetry.sampler = result;
}
