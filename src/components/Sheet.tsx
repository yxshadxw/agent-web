import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import anime from 'animejs';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
};

export function Sheet({ open, onClose, children, label, className }: Props) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    if (open) {
      anime({ targets: backdrop, opacity: [0, 1], duration: 240, easing: 'linear' });
      anime({
        targets: panel,
        translateY: ['102%', '0%'],
        duration: 400,
        easing: 'cubicBezier(0.22, 1, 0.36, 1)',
      });
      const rows = panel.querySelectorAll('.sheet-row, .sheet-anim');
      anime({
        targets: rows,
        opacity: [0, 1],
        translateY: [10, 0],
        delay: anime.stagger(18, { start: 90 }),
        duration: 320,
        easing: 'easeOutQuad',
      });
    } else {
      anime({ targets: backdrop, opacity: [1, 0], duration: 200, easing: 'linear' });
      anime({
        targets: panel,
        translateY: ['0%', '102%'],
        duration: 280,
        easing: 'easeInCubic',
        complete: () => setMounted(false),
      });
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={`sheet-layer ${className || ''}`}>
      <div className="sheet-backdrop" ref={backdropRef} onClick={onClose} />
      <div className="sheet-wrap">
        <div className="sheet-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={label}>
          <div className="sheet-grabber" aria-hidden="true" />
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
