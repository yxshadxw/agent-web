import { useState } from 'react';
import { diffLines } from 'diff';
import { Check, Copy } from 'lucide-react';

type DiffProps = {
  oldText?: string;
  newText?: string;
  rawDiff?: string;
  fileName?: string;
};

type LineItem = {
  kind: 'add' | 'del' | 'hunk' | 'ctx';
  text: string;
};

function parseRawDiff(raw: string): LineItem[] {
  return raw
    .split(/\r?\n/)
    .slice(0, 180)
    .map((line) => {
      if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) {
        return { kind: 'hunk', text: line };
      }
      if (line.startsWith('+++') || line.startsWith('---')) {
        return { kind: 'hunk', text: line };
      }
      if (line.startsWith('+')) return { kind: 'add', text: line };
      if (line.startsWith('-')) return { kind: 'del', text: line };
      return { kind: 'ctx', text: line };
    });
}

export function hasDiffSignal(text?: string) {
  if (!text) return false;
  return /^(?:\+{3}|-{3}|@@|\+[^+]|-[^-])/m.test(text);
}

export function ToolDiff({ oldText, newText, rawDiff, fileName }: DiffProps) {
  const [copied, setCopied] = useState(false);
  let lines: LineItem[] = [];

  if (typeof oldText === 'string' && typeof newText === 'string') {
    const parts = diffLines(oldText, newText);
    for (const part of parts) {
      const prefix = part.added ? '+' : part.removed ? '-' : ' ';
      const kind: LineItem['kind'] = part.added ? 'add' : part.removed ? 'del' : 'ctx';
      const split = part.value.replace(/\n$/, '').split('\n');
      for (const l of split) {
        lines.push({ kind, text: `${prefix}${l}` });
        if (lines.length >= 180) break;
      }
      if (lines.length >= 180) break;
    }
  } else if (rawDiff && hasDiffSignal(rawDiff)) {
    lines = parseRawDiff(rawDiff);
  } else {
    return null;
  }

  if (!lines.length) return null;

  const copyDiff = async () => {
    try {
      await navigator.clipboard.writeText(lines.map((l) => l.text).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="tool-diff-wrap">
      <div className="tool-detail-label tool-diff-head">
        <span>변경 사항{fileName ? ` · ${fileName.split('/').pop()}` : ''}</span>
        <button
          type="button"
          className="tool-diff-copy"
          onClick={() => void copyDiff()}
          aria-label="변경 사항 복사"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? '복사됨' : '복사'}</span>
        </button>
      </div>
      <pre className="tool-diff">
        {lines.map((item, idx) => (
          <div key={idx} className={`diff-line diff-${item.kind}`}>
            {item.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
