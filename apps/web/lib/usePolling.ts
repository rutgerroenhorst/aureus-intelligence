"use client";
import { useEffect, useRef } from "react";

interface PollOptions {
  /** After this long without a touch/click/key/wheel the interval stretches to idleIntervalMs. */
  idleAfterMs?: number;
  idleIntervalMs?: number;
}

/**
 * Runs `fn` immediately and then repeatedly, but only while the tab is visible.
 * A hidden tab (screen off, other app, other tab) makes no requests at all; coming back to it
 * refreshes at once. This keeps the free Vercel quota (1M requests / 4 CPU-hours a month)
 * from being spent on screens nobody is looking at.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number, opts: PollOptions = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { idleAfterMs = 3 * 60_000, idleIntervalMs = 60_000 } = opts;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRun = 0;
    let lastInteraction = Date.now();
    let running = false;
    let stopped = false;

    const nextDelay = () =>
      Date.now() - lastInteraction > idleAfterMs ? Math.max(idleIntervalMs, intervalMs) : intervalMs;

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
        clearTimeout(timer);
        return;
      }
      // Back on screen: refresh right away only if the data is already due, otherwise just re-arm.
      if (dueIn() === 0) void run().then(schedule);
      else schedule();
    };

    const onInteract = () => {
      const wasIdle = Date.now() - lastInteraction > idleAfterMs;
      lastInteraction = Date.now();
      if (wasIdle && !document.hidden && Date.now() - lastRun >= intervalMs) void run().then(schedule);
    };

    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    void run().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    for (const ev of events) window.addEventListener(ev, onInteract, { passive: true });

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const ev of events) window.removeEventListener(ev, onInteract);
    };
  }, [intervalMs, idleAfterMs, idleIntervalMs]);
}
