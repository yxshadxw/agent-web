type MarkProps = {
  size?: number;
  className?: string;
};

export function AnthropicMark({ size = 18, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M12 2.4v5.4M12 16.2v5.4M2.4 12h5.4M16.2 12h5.4" />
        <path d="M5.2 5.2l3.8 3.8M15 15l3.8 3.8M18.8 5.2L15 9M9 15l-3.8 3.8" />
      </g>
    </svg>
  );
}

export function OpenAIMark({ size = 18, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 2.9l7.6 4.4v8.8L12 20.5l-7.6-4.4V7.3L12 2.9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.1l4.2 2.4v4.9L12 16.9l-4.2-2.5V9.5L12 7.1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandGlyph() {
  return (
    <span className="brand-glyph" aria-hidden="true">
      <span />
    </span>
  );
}
