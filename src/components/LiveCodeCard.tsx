import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import { ChevronDown, Radio, X } from 'lucide-react';
import { highlightCodeLines } from '../lib/markdown';
import { cancelSmoothScroll, smoothScrollToBottom } from '../lib/smoothScroll';

export type LiveCodeCardProps = {
  fileName: string;
  filePath?: string;
  code: string;
  oldCode?: string;
  running: boolean;
  defaultExpanded?: boolean;
  className?: string;
  onClose?: () => void;
};

export const LiveCodeCard = memo(function LiveCodeCard({
  fileName,
  filePath,
  code,
  oldCode = '',
  running,
  defaultExpanded = false,
  className = '',
  onClose,
}: LiveCodeCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || running);
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);

  const { lines, addedSet } = useMemo(() => {
    if (!code) return { lines: [] as string[], addedSet: new Set<number>() };
    const highlighted = highlightCodeLines(code, filePath || fileName);
    const added = new Set<number>();
    if (oldCode) {
      const changes = diffLines(oldCode, code);
      let lineNo = 1;
      for (const change of changes) {
        const count = change.value.split('\n').length - (change.value.endsWith('\n') ? 1 : 0);
        if (change.added) {
          for (let i = 0; i < count; i += 1) added.add(lineNo + i);
        }
        if (!change.removed) lineNo += count;
      }
    } else {
      for (let i = 1; i <= highlighted.length; i += 1) added.add(i);
    }
    return { lines: highlighted, addedSet: added };
  }, [code, oldCode, filePath, fileName]);

  useEffect(() => {
    if (!follow || !expanded) return;
    const el = bodyRef.current;
    if (!el) return;
    smoothScrollToBottom(el, { shouldContinue: () => followRef.current });
  }, [follow, expanded, code.length]);

  return (
    <div className={`chat-live-card ${className}`.trim()}>
      <div className="live-viewer-head">
        <span className={`live-dot ${running ? 'writing' : 'saved'}`} />
        <button
          type="button"
          className="live-viewer-name"
          onClick={() => setExpanded((v) => !v)}
          title={filePath || fileName}
        >
          {fileName}
        </button>
        <span className="live-viewer-stat">
          {running ? '작성 중' : '저장됨'} · +{lines.length}
        </span>
        <div className="live-viewer-actions">
          <button
            type="button"
            className={`live-follow-btn ${follow ? 'active' : ''}`}
            onClick={() => {
              const next = !follow;
              setFollow(next);
              if (next && !expanded) setExpanded(true);
            }}
          >
            <Radio size={12} />
            <span>따라가며</span>
          </button>
          <button
            type="button"
            className="live-icon-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '코드 접기' : '코드 펼치기'}
          >
            <ChevronDown size={13} className={expanded ? 'flip' : ''} />
          </button>
          {onClose && (
            <button
              type="button"
              className="live-icon-btn"
              onClick={onClose}
              aria-label="라이브 뷰어 닫기"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div
          className="live-viewer-body chat-live-body"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (!atBottom && followRef.current) {
              setFollow(false);
              cancelSmoothScroll(el);
            }
          }}
        >
          {lines.length === 0 ? (
            <div className="live-viewer-empty">작성 대기 중…</div>
          ) : (
            <div className="live-code">
              {lines.map((lineHtml, idx) => {
                const no = idx + 1;
                return (
                  <div
                    className={`live-code-line ${addedSet.has(no) ? 'is-added' : ''}`}
                    key={no}
                  >
                    <span className="live-code-n">{no}</span>
                    <code
                      className="hljs"
                      dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
