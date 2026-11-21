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
      if (!content || content.length > 360) continue;
      if (/orca\s+orchestration\s+reply|오퍼레이터에게.*회신/i.test(content)) continue;
      // Match by leading step number ("1.", "1단계:") if present so updated lines overwrite the same slot.
      const stepMatch = content.match(/^(\d+\s*(?:\.|단계))\s*/);
      const key = stepMatch ? `stepnum:${stepMatch[1].replace(/\s+/g, '')}` : content.toLowerCase();
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
        status: existing?.status === 'completed' && status === 'pending' ? 'completed' : status,
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
 * Build a Todo checklist from the start of a task and advance stages one by
 * one (`pending` -> `in_progress` -> `completed`) as the agent works.
 */
export function deriveTodosFromTools(
  tools: RawToolLike[],
  texts: string[] = [],
  busy = false,
): TodoItem[] {
  const checklist = parseChecklistTodos(texts, busy);
  if (checklist.length >= 1) {
    if (!busy) {
      return checklist.map((item) => ({
        ...item,
        status: item.status === 'cancelled' ? 'cancelled' : 'completed',
      }));
    }
    const explicitCompleted = checklist.filter((item) => item.status === 'completed').length;
    if (explicitCompleted === 0 && tools.length > 0) {
      const doneTools = tools.filter((t) => {
        const st = String(t.status || t.state || (t.running ? 'running' : 'completed')).toLowerCase();
        return !t.running && !st.includes('progress') && st !== 'running' && st !== 'pending';
      }).length;
      // Advance checklist steps proportionally as tools complete during the turn (up to N-1 while busy).
      const autoDone = Math.min(
        checklist.length - 1,
        Math.floor((doneTools / Math.max(2, checklist.length * 2)) * checklist.length),
      );
      if (autoDone > 0) {
        return checklist.map((item, idx) => ({
          ...item,
          status:
            idx < autoDone
              ? 'completed'
              : idx === autoDone
                ? 'in_progress'
                : 'pending',
        }));
      }
    }
    return checklist;
  }

  if (!busy && tools.length === 0) return [];

  const stepMap = new Map<string, { label: string; phase: ToolPhase }>();
  let highestPhaseIdx = 0;
  const order: Record<ToolPhase, number> = {
    explore: 0,
    edit: 1,
    verify: 2,
    finish: 3,
  };

  for (const tool of tools) {
    const { phase, detailLabel } = classifyTool(tool);
    const idx = order[phase];
    if (idx > highestPhaseIdx) highestPhaseIdx = idx;
    const label =
      detailLabel ||
      (phase === 'explore'
        ? '작업 범위 및 코드 구조 파악'
        : phase === 'edit'
          ? '코드 수정 및 기능 구현'
          : phase === 'verify'
            ? '빌드 및 테스트 검증'
            : '변경사항 반영 및 결과 정리');
    const key = `${phase}:${label}`;
    if (!stepMap.has(key)) {
      stepMap.set(key, { label, phase });
    }
  }

  if (stepMap.size === 0) {
    stepMap.set('explore:init', { label: '작업 범위 및 코드 구조 파악', phase: 'explore' });
  }
  if (busy) {
    if (highestPhaseIdx < 1 && ![...stepMap.values()].some((s) => s.phase === 'edit')) {
      stepMap.set('edit:pending', { label: '코드 수정 및 기능 구현', phase: 'edit' });
    }
    if (highestPhaseIdx < 2 && ![...stepMap.values()].some((s) => s.phase === 'verify')) {
      stepMap.set('verify:pending', { label: '빌드 및 동작 검증', phase: 'verify' });
    }
  }

  const entries = [...stepMap.entries()];
  if (!busy) {
    return entries.map(([key, item], idx) => ({
      id: `step-${idx}-${key}`,
      content: item.label,
      status: 'completed',
    }));
  }

  let activeAssigned = false;
  return entries.map(([key, item], idx) => {
    const pIdx = order[item.phase];
    if (pIdx < highestPhaseIdx) {
      return { id: `step-${idx}-${key}`, content: item.label, status: 'completed' };
    }
    if (pIdx === highestPhaseIdx && !activeAssigned) {
      activeAssigned = true;
      return { id: `step-${idx}-${key}`, content: item.label, status: 'in_progress' };
    }
    if (pIdx === highestPhaseIdx) {
      return { id: `step-${idx}-${key}`, content: item.label, status: 'completed' };
    }
    return { id: `step-${idx}-${key}`, content: item.label, status: 'pending' };
  });
}
