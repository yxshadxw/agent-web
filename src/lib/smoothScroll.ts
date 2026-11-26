const activeFrames = new WeakMap<HTMLElement, number>();
const lastTimes = new WeakMap<HTMLElement, number>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export function cancelSmoothScroll(el: HTMLElement | null | undefined) {
  if (!el) return;
  const frame = activeFrames.get(el);
  if (frame) {
    window.cancelAnimationFrame(frame);
    activeFrames.delete(el);
  }
  lastTimes.delete(el);
}

/**
 * Smoothly glides a scroll container to its bottom using frame-rate-independent
 * exponential damping. Avoids fighting CSS `scroll-behavior: smooth` during
 * rapid streaming updates.
 */
export function smoothScrollToBottom(
  el: HTMLElement | null | undefined,
  options?: { instant?: boolean; shouldContinue?: () => boolean },
) {
  if (!el) return;

  const target = Math.max(0, el.scrollHeight - el.clientHeight);
  const distance = target - el.scrollTop;

  if (
    options?.instant ||
    prefersReducedMotion() ||
    Math.abs(distance) <= 1 ||
    distance > 1800
  ) {
    cancelSmoothScroll(el);
    el.scrollTop = target;
    return;
  }

  if (activeFrames.has(el)) return;

  lastTimes.set(el, performance.now());

  const step = (now: number) => {
    activeFrames.delete(el);
    if (!el.isConnected || (options?.shouldContinue && !options.shouldContinue())) {
      lastTimes.delete(el);
      return;
    }

    const prev = lastTimes.get(el) ?? now;
    lastTimes.set(el, now);
    const dt = Math.min(0.05, Math.max(0.004, (now - prev) / 1000));

    const goal = Math.max(0, el.scrollHeight - el.clientHeight);
    const remaining = goal - el.scrollTop;

    if (Math.abs(remaining) <= 0.8) {
      el.scrollTop = goal;
      lastTimes.delete(el);
      return;
    }

    const factor = 1 - Math.exp(-14 * dt);
    el.scrollTop += remaining * factor;
    activeFrames.set(el, window.requestAnimationFrame(step));
  };

  activeFrames.set(el, window.requestAnimationFrame(step));
}
