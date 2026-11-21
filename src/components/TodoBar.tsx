import { useEffect, useState } from 'react';
import { Check, ChevronUp, Loader2, X } from 'lucide-react';

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
};

export function TodoBar({
  todos,
  onToast,
}: {
  todos: TodoItem[];
  onToast?: (message: string) => void;
}) {
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (todos.length > 0) setVisible(true);
  }, [todos.length]);

  if (!todos.length || !visible) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.find((t) => t.status === 'in_progress');
  const pending = todos.find((t) => t.status === 'pending');
  const allDone = todos.length > 0 && completed === todos.length;
  const ratio = todos.length > 0 ? completed / todos.length : 0;
  const litCount = allDone ? 3 : ratio >= 0.66 ? 2 : 1;
  const title =
    inProgress?.content ||
    (allDone ? '모두 끝났어요' : pending?.content || '진행 중');

  return (
    <div className={`todo-card ${open ? 'expanded' : ''} ${allDone ? 'is-done' : 'is-active'}`}>
      <div className="todo-head">
        <button
          type="button"
          className="todo-summary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="todo-bars" aria-hidden="true">
            {[0, 1, 2].map((idx) => (
              <i
                key={idx}
                className={
                  allDone
                    ? 'done'
                    : idx < litCount
                      ? 'active'
                      : 'dim'
                }
              />
            ))}
          </span>
          <span className="todo-title">{title}</span>
          <span className="todo-count">
            {completed} / {todos.length}
          </span>
        </button>
        <button
          type="button"
          className="todo-mini"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '할 일 접기' : '할 일 펼치기'}
        >
          <ChevronUp size={16} className={`chev ${open ? 'flip' : ''}`} />
        </button>
        <button
          type="button"
          className="todo-mini"
          onClick={() => {
            setVisible(false);
            onToast?.('할 일 카드를 숨겼어요');
          }}
          aria-label="할 일 카드 닫기"
        >
          <X size={16} />
        </button>
      </div>
      <div className="todo-body">
        <div className="todo-body-inner">
          <ul>
            {todos.map((todo) => (
              <li key={todo.id} className={`todo-item status-${todo.status}`}>
                <span className={`todo-check status-${todo.status}`}>
                  {todo.status === 'completed' ? (
                    <Check size={11} strokeWidth={3} />
                  ) : todo.status === 'in_progress' ? (
                    <Loader2 size={11} className="spin" />
                  ) : todo.status === 'cancelled' ? (
                    <X size={11} />
                  ) : null}
                </span>
                <span>{todo.content}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

type RawToolLike = {
  id?: string;
  name?: string;
  tool?: string;
  label?: string;
  command?: string;
  detail?: string;
  status?: string;
  state?: string;
  running?: boolean;
};

function shortFileName(rawPath: string): string {
  const clean = rawPath.replace(/['"`]/g, '').trim();
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || clean;
}

type ToolPhase = 'explore' | 'edit' | 'verify' | 'finish';

function classifyTool(tool: RawToolLike): { phase: ToolPhase; detailLabel?: string } {
  const kind = String(tool.tool || tool.name || '').toLowerCase();
  const raw = String(tool.command || tool.detail || '').replace(/\s+/g, ' ').trim();

  if (/edit|write|replace|patch|create/i.test(kind)) {
    const file = raw && !raw.startsWith('{') ? shortFileName(raw) : '';
    return {
      phase: 'edit',
      detailLabel: file ? `${file} 수정 및 기능 구현` : '코드 수정 및 기능 구현',
    };
  }

  if (/bash|shell|run|exec|command/i.test(kind) || raw) {
    if (/git\s+(commit|push)|orca\s+orchestration\s+(reply|send)/i.test(raw)) {
      return { phase: 'finish', detailLabel: '변경사항 커밋·푸시 및 결과 정리' };
    }
    if (
      /cargo\s+(test|clippy|check|build)|npm\s+(test|run\s+build)|node\s+--check|pytest|vitest|jest|tsc|playwright/i.test(
        raw,
      )
    ) {
      return { phase: 'verify', detailLabel: '빌드 및 테스트 검증' };
    }
  }

  if (/read|view|grep|search|glob|find|list/i.test(kind)) {
    const file = raw && /^\/[\w./-]+$/.test(raw) ? shortFileName(raw) : '';
    return {
      phase: 'explore',
      detailLabel: file ? `${file} 등 코드 구조 파악` : '작업 범위 및 코드 구조 파악',
    };
  }

  return { phase: 'explore' };
}

/**
 * Extract markdown checklist todos (`- [ ]`, `- [/]`, `- [x]`) from assistant
 * messages or thinking text so agents that write a checklist drive the TodoBar.
 */
export function parseChecklistTodos(texts: string[], busy = false): TodoItem[] {
  const lineRe = /^\s*(?:[-*+]|\d+\.)\s*\[([ xX/~-])\]\s+(.+)$/;
  const map = new Map<string, TodoItem>();

  for (const text of texts) {
    if (!text) continue;
    for (const rawLine of text.split('\n')) {
      const match = rawLine.match(lineRe);
      if (!match) continue;
      const mark = match[1].toLowerCase();
      const content = match[2]
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim();
      if (!content || content.length > 90) continue;
      const key = content.toLowerCase();
      const status: TodoItem['status'] =
        mark === 'x'
          ? 'completed'
          : mark === '/' || mark === '~' || mark === '-'
            ? 'in_progress'
            : 'pending';
      const existing = map.get(key);
      map.set(key, {
        id: existing?.id || `chk-${map.size}-${key.slice(0, 20)}`,
        content,
        status,
      });
    }
  }

  const list = [...map.values()];
  if (list.length > 0 && busy && !list.some((item) => item.status === 'in_progress')) {
    const firstPending = list.find((item) => item.status === 'pending');
    if (firstPending) firstPending.status = 'in_progress';
  }
  return list;
}

/**
 * Build a complete 4-stage Todo checklist right from the start of a task and
 * advance stages one by one (`pending` -> `in_progress` -> `completed`) as the
 * agent explores, edits, verifies, and finishes.
 */
export function deriveTodosFromTools(
  tools: RawToolLike[],
  texts: string[] = [],
  busy = false,
): TodoItem[] {
  const checklist = parseChecklistTodos(texts, busy);
  if (checklist.length >= 2) return checklist.slice(0, 8);

  if (!busy && tools.length === 0) return [];

  const stages: { key: ToolPhase; label: string }[] = [
    { key: 'explore', label: '작업 범위 및 코드 구조 파악' },
    { key: 'edit', label: '코드 수정 및 기능 구현' },
    { key: 'verify', label: '빌드 및 테스트 검증' },
    { key: 'finish', label: '변경사항 반영 및 결과 정리' },
  ];

  const order: Record<ToolPhase, number> = {
    explore: 0,
    edit: 1,
    verify: 2,
    finish: 3,
  };

  let highestPhaseIdx = 0;
  for (const tool of tools) {
    const { phase, detailLabel } = classifyTool(tool);
    const idx = order[phase];
    if (detailLabel) stages[idx].label = detailLabel;
    if (idx > highestPhaseIdx) highestPhaseIdx = idx;
  }

  if (!busy) {
    // Task finished: all 4 planned steps are completed.
    return stages.map((stage, idx) => ({
      id: `stage-${stage.key}-${idx}`,
      content: stage.label,
      status: 'completed',
    }));
  }

  // Task is currently running: all 4 todos exist from the start; earlier phases
  // are completed, current phase is in_progress (yellow), later phases are pending.
  return stages.map((stage, idx) => ({
    id: `stage-${stage.key}-${idx}`,
    content: stage.label,
    status:
      idx < highestPhaseIdx
        ? 'completed'
        : idx === highestPhaseIdx
          ? 'in_progress'
          : 'pending',
  }));
}
