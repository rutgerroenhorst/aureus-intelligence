"use client";
import { useEffect, useRef } from "react";

/** Fired on window by the shell when a scan has just finished, so open pages can refetch at once. */
export const SCAN_DONE_EVENT = "aureus:scan-done";

/** Run `fn` whenever the shell reports that fresh scan data is in. */
export function useOnScanDone(fn: () => void) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const handler = () => fnRef.current();
    window.addEventListener(SCAN_DONE_EVENT, handler);
    return () => window.removeEventListener(SCAN_DONE_EVENT, handler);
  }, []);
}

interface PollOptions {
  /** After this long without a touch/click/key/wheel the interval stretches to idleIntervalMs. */
  idleAfterMs?: number;
  idleIntervalMs?: number;
  /** A screen left on and untouched for this long (an iPad on a stand, a tab on a second monitor) slows right down. */
  deepIdleAfterMs?: number;
  deepIdleIntervalMs?: number;
}

export const DEFAULT_IDLE_AFTER_MS = 3 * 60_000;
export const DEFAULT_IDLE_INTERVAL_MS = 60_000;
export const DEFAULT_DEEP_IDLE_AFTER_MS = 15 * 60_000;
export const DEFAULT_DEEP_IDLE_INTERVAL_MS = 5 * 60_000;

/**
 * How long to wait between refreshes, given how long nobody has touched the screen. Three tiers:
 * in use -> `intervalMs`, idle -> a minute, deeply idle -> five minutes. Never faster than `intervalMs`.
 */
export function pollDelay(idleMs: number, intervalMs: number, opts: PollOptions = {}): number {
  const {
    idleAfterMs = DEFAULT_IDLE_AFTER_MS,
    idleIntervalMs = DEFAULT_IDLE_INTERVAL_MS,
    deepIdleAfterMs = DEFAULT_DEEP_IDLE_AFTER_MS,
    deepIdleIntervalMs = DEFAULT_DEEP_IDLE_INTERVAL_MS,
  } = opts;
  if (idleMs > deepIdleAfterMs) return Math.max(deepIdleIntervalMs, idleIntervalMs, intervalMs);
  if (idleMs > idleAfterMs) return Math.max(idleIntervalMs, intervalMs);
  return intervalMs;
}

// One shared record of the last time a person touched the page, for code that must not do optional work for a screen
// nobody is using (the shell does not ask for a market scan then). Installed once, on first use in the browser.
let lastTouchAt = Date.now();
let tracking = false;
const TOUCH_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

function trackTouches() {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  for (const ev of TOUCH_EVENTS) window.addEventListener(ev, () => { lastTouchAt = Date.now(); }, { passive: true, capture: true });
}

/** Milliseconds since anybody touched this page (or opened/returned to it). */
export function msSinceTouch(): number {
  return Date.now() - lastTouchAt;
}

/**
 * Runs `fn` immediately and then repeatedly, but only while the tab is visible.
 * A hidden tab (screen off, other app, other tab) makes no requests at all; coming back to it
 * refreshes at once. An untouched screen backs off (see pollDelay). This keeps the free Vercel quota
 * (1M requests / 4 CPU-hours a month) from being spent on screens nobody is looking at.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number, opts: PollOptions = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { idleAfterMs, idleIntervalMs, deepIdleAfterMs, deepIdleIntervalMs } = opts;

  useEffect(() => {
    trackTouches();
    const options: PollOptions = { idleAfterMs, idleIntervalMs, deepIdleAfterMs, deepIdleIntervalMs };
    const idleThreshold = idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRun = 0;
    let lastInteraction = Date.now();
    let hiddenSince: number | null = null;
    let running = false;
    let stopped = false;

    const nextDelay = () => pollDelay(Date.now() - lastInteraction, intervalMs, options);

    // Time left until the next refresh, measured from the LAST refresh. Re-arming a full-length timer on
    // every visibility change (some browsers flip visibility every few seconds) would never let the
    // idle interval take effect and would refresh as often as the active interval.
    const dueIn = () => Math.max(0, nextDelay() - (Date.now() - lastRun));

    const run = async () => {
      if (running || stopped) return;
      running = true;
      lastRun = Date.now();
      try {
        await fnRef.current();
      } catch {
        // callers handle their own errors; a failed poll must never stop the loop
      } finally {
        running = false;
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = setTimeout(async () => {
        await run();
        schedule();
      }, dueIn());
    };

    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        clearTimeout(timer);
        return;
      }
      // Coming back to the app after a real absence is a deliberate act, so it counts as being in use again. A short
      // flip (some embedded browsers flip every few seconds) does not, or the idle back-off would never apply.
      if (hiddenSince != null && Date.now() - hiddenSince > 30_000) {
        lastInteraction = Date.now();
        lastTouchAt = Date.now();
      }
      hiddenSince = null;
      // Back on screen: refresh right away only if the data is already due, otherwise just re-arm.
      if (dueIn() === 0) void run().then(schedule);
      else schedule();
    };

    const onInteract = () => {
      const wasIdle = Date.now() - lastInteraction > idleThreshold;
      lastInteraction = Date.now();
      if (wasIdle && !document.hidden && Date.now() - lastRun >= intervalMs) void run().then(schedule);
    };

    void run().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    for (const ev of TOUCH_EVENTS) window.addEventListener(ev, onInteract, { passive: true });

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const ev of TOUCH_EVENTS) window.removeEventListener(ev, onInteract);
    };
  }, [intervalMs, idleAfterMs, idleIntervalMs, deepIdleAfterMs, deepIdleIntervalMs]);
}
