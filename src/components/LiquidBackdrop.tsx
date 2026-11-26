/**
 * Lightweight CSS-only liquid-glass backdrop.
 * Avoids running a continuous full-screen WebGL shader loop behind blurred DOM layers.
 */
export function LiquidBackdrop({ className = '' }: { className?: string }) {
  return (
    <div
      className={`liquid-backdrop ${className}`.trim()}
      aria-hidden="true"
      style={{
        background:
          'radial-gradient(60% 55% at 78% 14%, rgba(242, 118, 58, 0.08), transparent 65%), radial-gradient(50% 50% at 18% 82%, rgba(115, 61, 255, 0.07), transparent 65%)',
      }}
    />
  );
}
