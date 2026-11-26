import { memo, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export type BackgroundRunItem = {
  id: string;
  label: string;
  detail?: string;
  output?: string;
  status: 'running' | 'done' | 'stopped';
  duration?: string;
};

const AUTO_DISMISS_MS = 4000;
const LEAVE_ANIM_MS = 320;

export const BackgroundRunChips = memo(function BackgroundRunChips({
  runs,
  onDismiss,
}: {
  runs: BackgroundRunItem[];
  onDismiss?: (id: string) => void;
}) {
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());
  const timersRef = useRef<Map<string, number>>(new Map());
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const activeIds = new Set(runs.map((r) => r.id));

    for (const [id, timer] of timersRef.current.entries()) {
      const item = runs.find((r) => r.id === id);
      if (!activeIds.has(id) || !item || item.status === 'running' || inspectId === id) {
        window.clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }

    for (const run of runs) {
      if (run.status === 'running' || inspectId === run.id || timersRef.current.has(run.id)) {
        continue;
      }
      const timer = window.setTimeout(() => {
        timersRef.current.delete(run.id);
        setLeavingIds((prev) => {
          const next = new Set(prev);
          next.add(run.id);
          return next;
        });
        window.setTimeout(() => {
          onDismissRef.current?.(run.id);
        }, LEAVE_ANIM_MS);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(run.id, timer);
    }
  }, [runs, inspectId]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  if (!runs.length) return null;

  const inspected = inspectId ? runs.find((r) => r.id === inspectId) ?? null : null;

  return (
    <div className="desk-run-wrap">
      {inspected && (inspected.output || inspected.detail) && (
        <div className="desk-run-preview" role="region" aria-label="백그라운드 작업 출력">
          <div className="desk-run-preview-head">
            <span className={`desk-run-dot is-${inspected.status}`} aria-hidden="true" />
            <strong>{inspected.label}</strong>
            <span className="desk-run-tag">
              {inspected.status === 'running'
                ? '실행 중'
                : inspected.status === 'stopped'
                  ? '중단됨'
                  : '완료됨'}
              {inspected.duration ? ` · ${inspected.duration}` : ''}
            </span>
            <button
              type="button"
              className="desk-run-close"
              onClick={() => setInspectId(null)}
              aria-label="출력 닫기"
            >
              <X size={12} />
            </button>
          </div>
          <pre className="desk-run-preview-body">
            {inspected.output || inspected.detail}
          </pre>
        </div>
      )}

      <div className="desk-run-chips" role="status" aria-live="polite">
        {runs.map((run) => {
          const canInspect = Boolean(run.output || run.detail);
          const isLeaving = leavingIds.has(run.id);
          return (
            <span
              className={`desk-run-chip is-${run.status} ${inspectId === run.id ? 'is-open' : ''} ${isLeaving ? 'is-leaving' : ''}`}
              key={run.id}
              title={run.detail || run.label}
            >
              <button
                type="button"
                className="desk-run-chip-main"
                onClick={() => {
                  if (!canInspect) return;
                  setInspectId((cur) => (cur === run.id ? null : run.id));
                }}
                disabled={!canInspect}
              >
                <i className={`desk-run-dot is-${run.status}`} aria-hidden="true" />
                <b>{run.label}</b>
                <span className="desk-run-tag">
                  {run.status === 'running'
                    ? '실행 중'
                    : run.status === 'stopped'
                      ? '중단됨'
                      : '완료됨'}
                </span>
              </button>
              {run.status !== 'running' && onDismiss && (
                <button
                  type="button"
                  className="desk-run-dismiss"
                  onClick={() => {
                    if (inspectId === run.id) setInspectId(null);
                    onDismiss(run.id);
                  }}
                  aria-label={`${run.label} 닫기`}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
});
