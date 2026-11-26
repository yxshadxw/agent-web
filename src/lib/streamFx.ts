import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from './markdown';

export const FX_MS = 680;

export type StreamEffect = 'bounce' | 'fade' | 'ember';

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!,
  );

/**
 * Markdown is re-rendered while an answer streams, so a CSS animation on each
 * element would restart on every update. Instead every word remembers when it
 * first appeared; its negative animation-delay resumes from that age. Words
 * that have finished are left as plain text.
 */
export class Reveal {
  private births: number[] = [];
  started = false;

  reset() {
    this.births = [];
    this.started = false;
  }

  /**
   * Plain text (thinking). Words older than the effect are one untouched
   * string; only the tail that is still animating becomes spans, so the cost
   * does not grow with the length of the text.
   */
  applyText(text: string): string {
    const now = performance.now();
    this.births.length = Math.min(this.births.length, text.length);
    while (this.births.length < text.length) this.births.push(now);

    let cut = text.length;
    while (cut > 0 && now - this.births[cut - 1] < FX_MS) cut -= 1;
    while (cut > 0 && !/\s/.test(text[cut - 1])) cut -= 1;

    let out = escapeHtml(text.slice(0, cut));
    let offset = cut;
    for (const part of text.slice(cut).match(/\s+|\S+/g) ?? []) {
      const age = Math.max(0, now - this.births[offset]);
      out +=
        /\S/.test(part) && age < FX_MS
          ? `<span class="w" style="animation-delay:-${Math.round(age)}ms">${escapeHtml(part)}</span>`
          : escapeHtml(part);
      offset += part.length;
    }
    return out;
  }

  apply(html: string): string {
    const now = performance.now();
    const template = document.createElement('template');
    template.innerHTML = html;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    let offset = 0;
    for (const node of nodes) {
      const text = node.data;
      const len = text.length;
      while (this.births.length < offset + len) this.births.push(now);

      if (node.parentElement?.closest('pre, button')) {
        offset += len;
        continue;
      }

      // Fast-path: if the newest character in this text node has already
      // finished its reveal animation, leave the entire node untouched.
      if (len === 0 || now - this.births[offset + len - 1] >= FX_MS) {
        offset += len;
        continue;
      }

      const fragment = document.createDocumentFragment();
      let fresh = false;
      for (const part of text.match(/\s+|\S+/g) ?? []) {
        const age = Math.max(0, now - this.births[offset]);
        if (/\S/.test(part) && age < FX_MS) {
          const span = document.createElement('span');
          span.className = 'w';
          span.style.animationDelay = `-${Math.round(age)}ms`;
          span.textContent = part;
          fragment.append(span);
          fresh = true;
        } else {
          fragment.append(part);
        }
        offset += part.length;
      }
      if (fresh || fragment.childNodes.length) node.replaceWith(fragment);
    }
    return template.innerHTML;
  }
}

/** Snap a character cursor forward to the end of the current word so partial words don't flicker. */
export function snapToWordEdge(text: string, cursor: number): number {
  if (cursor >= text.length) return text.length;
  let next = cursor;
  while (next < text.length && !/\s/.test(text[next])) next += 1;
  return next;
}

/** Compute a gentle, readable character step based on lag and elapsed frame time. */
export function computeStep(lag: number, dtMs: number): number {
  if (lag <= 1) return lag;
  const dtScale = Math.max(0.5, Math.min(2.5, dtMs / 16.67));
  const base = lag <= 24 ? 1 : Math.min(8, Math.ceil(lag * 0.045));
  return Math.min(lag, Math.max(1, Math.round(base * dtScale)));
}

/** Find a safe `\n\n` boundary outside fenced code blocks so completed blocks can be cached. */
function findStableBlockSplit(slice: string): number {
  const idx = slice.lastIndexOf('\n\n');
  if (idx <= 0) return 0;
  const prefix = slice.slice(0, idx);
  const fences = prefix.match(/```/g);
  if (fences && fences.length % 2 === 1) return 0;
  return idx + 2;
}

/**
 * Render at 60fps while streaming with prefix block caching and time-normalized
 * word-by-word pacing so long answers never choke the main thread.
 */
export function useStreamMarkdown(source: string, streaming: boolean): string {
  const [html, setHtml] = useState(() => (streaming ? '' : renderMarkdown(source, true)));
  const revealRef = useRef<Reveal | null>(null);
  const targetRef = useRef(source);
  const shownLenRef = useRef(streaming ? 0 : source.length);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const settleTimerRef = useRef(0);
  const streamingRef = useRef(streaming);
  const cachedPrefixRef = useRef<{ split: number; src: string; html: string }>({
    split: 0,
    src: '',
    html: '',
  });

  streamingRef.current = streaming;

  useEffect(() => {
    const reveal = revealRef.current ?? (revealRef.current = new Reveal());
    const previous = targetRef.current;
    const sameSource = source === previous;

    if (!sameSource && !source.startsWith(previous)) {
      reveal.reset();
      shownLenRef.current = streaming ? 0 : source.length;
      cachedPrefixRef.current = { split: 0, src: '', html: '' };
    }
    targetRef.current = source;

    const renderWithCache = (slice: string, finished: boolean) => {
      if (finished) return renderMarkdown(slice, true);
      const split = findStableBlockSplit(slice);
      if (split > 0) {
        const prefixSrc = slice.slice(0, split);
        if (cachedPrefixRef.current.src !== prefixSrc) {
          cachedPrefixRef.current = {
            split,
            src: prefixSrc,
            html: renderMarkdown(prefixSrc, true),
          };
        }
        const tailSrc = slice.slice(split);
        return cachedPrefixRef.current.html + (tailSrc ? renderMarkdown(tailSrc, false) : '');
      }
      return renderMarkdown(slice, false);
    };

    const shouldCatchUp = reveal.started && shownLenRef.current < source.length;

    if (!streaming && !shouldCatchUp) {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      if (!reveal.started && sameSource) return;
      shownLenRef.current = source.length;
      const out = renderMarkdown(source, true);
      setHtml(reveal.started ? reveal.apply(out) : out);
      if (reveal.started) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = window.setTimeout(() => {
          setHtml(renderMarkdown(targetRef.current, true));
        }, FX_MS + 40);
      }
      return;
    }

    reveal.started = true;
    window.clearTimeout(settleTimerRef.current);
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

      if (shownLenRef.current !== prevShown || !streamingRef.current) {
        const slice = target.slice(0, shownLenRef.current);
        const finished = !streamingRef.current && shownLenRef.current >= target.length;
        const out = renderWithCache(slice, finished);
        setHtml(reveal.apply(out));
      }

      if (shownLenRef.current < targetRef.current.length) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        lastFrameRef.current = 0;
        if (!streamingRef.current) {
          settleTimerRef.current = window.setTimeout(() => {
            setHtml(renderMarkdown(targetRef.current, true));
          }, FX_MS + 40);
        }
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);
  }, [source, streaming]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return html;
}

/** Same word reveal for plain reasoning text; no markdown parse is involved. */
export function useStreamText(text: string, live: boolean): string {
  const [html, setHtml] = useState(() => (live ? '' : escapeHtml(text)));
  const revealRef = useRef<Reveal | null>(null);
  const targetRef = useRef(text);
  const shownLenRef = useRef(live ? 0 : text.length);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const settleTimerRef = useRef(0);
  const liveRef = useRef(live);

  liveRef.current = live;

  useEffect(() => {
    const reveal = revealRef.current ?? (revealRef.current = new Reveal());
    const previous = targetRef.current;
    const sameText = text === previous;

    if (!sameText && !text.startsWith(previous)) {
      reveal.reset();
      shownLenRef.current = live ? 0 : text.length;
    }
    targetRef.current = text;

    const shouldCatchUp = reveal.started && shownLenRef.current < text.length;

    if (!live && !shouldCatchUp) {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      if (!reveal.started && sameText) return;
      shownLenRef.current = text.length;
      setHtml(reveal.started ? reveal.applyText(text) : escapeHtml(text));
      if (reveal.started) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = window.setTimeout(() => {
          setHtml(escapeHtml(targetRef.current));
        }, FX_MS + 40);
      }
      return;
    }

    reveal.started = true;
    window.clearTimeout(settleTimerRef.current);
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

      if (shownLenRef.current !== prevShown || !liveRef.current) {
        setHtml(reveal.applyText(target.slice(0, shownLenRef.current)));
      }

      if (shownLenRef.current < targetRef.current.length) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        lastFrameRef.current = 0;
        if (!liveRef.current) {
          settleTimerRef.current = window.setTimeout(() => {
            setHtml(escapeHtml(targetRef.current));
          }, FX_MS + 40);
        }
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);
  }, [text, live]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return html;
}
