import { useEffect, useRef } from 'react';

const MOTES = [
  { x: 8, y: 24, size: 2.2, delay: -2, duration: 13 },
  { x: 18, y: 71, size: 1.6, delay: -7, duration: 16 },
  { x: 27, y: 42, size: 1.4, delay: -4, duration: 12 },
  { x: 36, y: 16, size: 1.8, delay: -9, duration: 15 },
  { x: 44, y: 82, size: 1.3, delay: -1, duration: 17 },
  { x: 53, y: 31, size: 1.5, delay: -11, duration: 14 },
  { x: 61, y: 63, size: 2, delay: -6, duration: 12 },
  { x: 69, y: 12, size: 1.4, delay: -3, duration: 18 },
  { x: 76, y: 47, size: 1.8, delay: -8, duration: 15 },
  { x: 84, y: 76, size: 1.5, delay: -5, duration: 13 },
  { x: 91, y: 28, size: 2.1, delay: -10, duration: 16 },
  { x: 95, y: 58, size: 1.3, delay: -2.5, duration: 14 },
];

/**
 * A CSS-only ambient light field. Soft warm, violet, and cyan washes drift
 * behind the translucent shell, with a faint grain and a few dust motes.
 * The depth grid and orbit rings add perspective without touching the layout,
 * and the pointer only changes two CSS variables so it never triggers React.
 */
export function AmbientBackdrop({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let nextX = 0;
    let nextY = 0;
    const paint = () => {
      frame = 0;
      node.style.setProperty('--ambient-x', `${nextX.toFixed(2)}px`);
      node.style.setProperty('--ambient-y', `${nextY.toFixed(2)}px`);
    };
    const onMove = (event: PointerEvent) => {
      nextX = (event.clientX / window.innerWidth - 0.5) * -26;
      nextY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * -18;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} className={`ambient-backdrop ${className}`.trim()} aria-hidden="true">
      <span className="ambient-wash ambient-wash-warm" />
      <span className="ambient-wash ambient-wash-violet" />
      <span className="ambient-wash ambient-wash-cyan" />
      <span className="ambient-horizon" />
      <span className="ambient-depth">
        <i className="ambient-grid" />
        <i className="ambient-orbit ambient-orbit-a" />
        <i className="ambient-orbit ambient-orbit-b" />
      </span>
      <span className="ambient-motes">
        {MOTES.map((mote) => (
          <i
            key={`${mote.x}-${mote.y}`}
            className="ambient-mote"
            style={{
              left: `${mote.x}%`,
              top: `${mote.y}%`,
              width: mote.size,
              height: mote.size,
              animationDelay: `${mote.delay}s`,
              animationDuration: `${mote.duration}s`,
            }}
          />
        ))}
      </span>
      <span className="ambient-grain" />
    </div>
  );
}
