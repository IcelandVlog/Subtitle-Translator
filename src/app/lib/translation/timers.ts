/**
 * Timers for the translation loop that keep running when the tab is in the background.
 *
 * Browsers throttle main-thread setTimeout in hidden tabs (≥1s clamp, and chained
 * timers are cut to ~1/min after a few minutes hidden). The translation loop waits
 * with many short chained delays, so switching tabs used to slow the run to a crawl.
 * Dedicated Web Workers are not subject to that throttling, so the timer runs there
 * and posts back. Falls back to plain setTimeout where Workers are unavailable (Node CLI,
 * SSR, or a worker that fails to start).
 */

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

type Callback = () => void;

let worker: Worker | null | undefined;
let seq = 0;
const callbacks = new Map<number, Callback>();

const fallbackToMainThread = () => {
  const pending = [...callbacks.values()];
  callbacks.clear();
  worker = null;
  for (const cb of pending) setTimeout(cb, 0);
};

const getWorker = (): Worker | null => {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      worker = null;
      return worker;
    }
    const source = "self.onmessage=function(e){var d=e.data;setTimeout(function(){self.postMessage(d.id)},d.ms)};";
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = (e: MessageEvent<number>) => {
      const cb = callbacks.get(e.data);
      if (cb) {
        callbacks.delete(e.data);
        cb();
      }
    };
    w.onerror = () => fallbackToMainThread();
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
};

/** Run `fn` after `ms`. Returns a function that cancels it. */
export const scheduleTimer = (fn: Callback, ms: number): (() => void) => {
  const capped = Math.min(Math.max(0, ms), MAX_TIMEOUT_MS);
  const w = getWorker();
  if (!w) {
    const timer = setTimeout(fn, capped);
    return () => clearTimeout(timer);
  }
  const id = ++seq;
  callbacks.set(id, fn);
  w.postMessage({ id, ms: capped });
  return () => {
    callbacks.delete(id);
  };
};
