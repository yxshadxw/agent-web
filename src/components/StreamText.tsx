import { memo, useEffect, useRef } from 'react';
import { FX_MS, computeStep, snapToWordEdge, type StreamEffect } from '../lib/streamFx';

/**
 * Incremental DOM renderer for reasoning text.
 * Appends new word spans directly into the container without replacing existing
 * nodes, so active CSS reveal animations never restart or stutter.
 */
export const RevealText = memo(function RevealText({
  text,
  active,
  className,
  effect = 'ember',
}: {
  text: string;
  active: boolean;
  className?: string;
  effect?: StreamEffect;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef(text);
  const shownLenRef = useRef(active ? 0 : text.length);
  const renderedTextRef = useRef('');
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const settleTimerRef = useRef(0);
  const activeRef = useRef(active);

  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const appendRange = (slice: string) => {
      if (!slice) return;
      const frag = document.createDocumentFragment();
      for (const part of slice.match(/\s+|\S+/g) ?? []) {
        if (/\S/.test(part)) {
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = part;
          frag.append(span);
        } else {
          frag.append(part);
        }
      }
      host.append(frag);
    };

    const previous = targetRef.current;
    const sameText = text === previous;

    if (!sameText && !text.startsWith(renderedTextRef.current)) {
      host.textContent = '';
      renderedTextRef.current = '';
      shownLenRef.current = active ? 0 : text.length;
      if (!active && text) {
        host.textContent = text;
        renderedTextRef.current = text;
      }
    } else if (!renderedTextRef.current && !active && text) {
      host.textContent = text;
      renderedTextRef.current = text;
      shownLenRef.current = text.length;
    }

    targetRef.current = text;
    window.clearTimeout(settleTimerRef.current);

    if (!active && shownLenRef.current >= text.length) {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      if (renderedTextRef.current !== text) {
        appendRange(text.slice(renderedTextRef.current.length));
        renderedTextRef.current = text;
        shownLenRef.current = text.length;
      }
      if (host.querySelector('.w')) {
        settleTimerRef.current = window.setTimeout(() => {
          if (hostRef.current && !activeRef.current) {
            hostRef.current.textContent = targetRef.current;
          }
        }, FX_MS + 60);
      }
      return;
    }

    if (frameRef.current) return;

    const tick = (now: number) => {
      frameRef.current = 0;
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 16.67;
      lastFrameRef.current = now;

      const target = targetRef.current;
      const prevShown = shownLenRef.current;
      const lag = target.length - prevShown;
      if (lag > 0) {
        const step = computeStep(lag, dt);
        shownLenRef.current = snapToWordEdge(target, Math.min(target.length, prevShown + step));
      }

      if (shownLenRef.current > renderedTextRef.current.length) {
        const nextSlice = target.slice(renderedTextRef.current.length, shownLenRef.current);
        appendRange(nextSlice);
        renderedTextRef.current = target.slice(0, shownLenRef.current);
      }

      if (shownLenRef.current < targetRef.current.length) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        lastFrameRef.current = 0;
        if (!activeRef.current && host.querySelector('.w')) {
          settleTimerRef.current = window.setTimeout(() => {
            if (hostRef.current && !activeRef.current) {
              hostRef.current.textContent = targetRef.current;
            }
          }, FX_MS + 60);
        }
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);
  }, [text, active]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`desk-think-text${className ? ` ${className}` : ''}`}
      data-fx={effect}
      data-live={active ? 'true' : undefined}
    />
  );
});
