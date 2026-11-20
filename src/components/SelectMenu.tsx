import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  meta?: string;
};

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = '선택',
  ariaLabel,
  className = '',
  disabled = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`select-menu ${open ? 'open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="select-trigger-label">{selected?.label || placeholder}</span>
        {selected?.meta && <small className="select-trigger-meta">{selected.meta}</small>}
        <ChevronDown size={13} className="select-chevron" />
      </button>
      {open && (
        <div className="select-pop" role="listbox" aria-label={ariaLabel}>
          {options.length === 0 && <div className="select-empty">{placeholder}</div>}
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`select-option ${active ? 'active' : ''}`}
                key={option.value || 'empty'}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="select-option-copy">
                  <b>{option.label}</b>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.meta && <em>{option.meta}</em>}
                {active && <Check size={13} className="select-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
