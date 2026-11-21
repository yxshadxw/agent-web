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
  const litCount = allDone ? 3 : ratio >= 0.66 ? 2 : ratio > 0 || inProgress ? 1 : 1;
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
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return parts[parts.length - 1] || clean;
}

function humanizeToolStep(tool: RawToolLike): { key: string; label: string } | null {
  if (tool.label && tool.label.trim() && !/^[/{]/.test(tool.label.trim())) {
    const lbl = tool.label.trim();
    return { key: `lbl:${lbl.toLowerCase()}`, label: lbl };
  }
  const kind = String(tool.tool || tool.name || '').toLowerCase();
  const raw = String(tool.command || tool.detail || '').replace(/\s+/g, ' ').trim();

  // Check if this is a TodoWrite JSON payload
  if (/todo/i.test(kind)) return null;

  if (/read|view|cat|head|tail/i.test(kind) || (!kind && /^\/[\w./-]+$/.test(raw))) {
    const file = shortFileName(raw || kind);
    return { key: `read:${file}`, label: `${file} 코드 확인` };
  }
  if (/edit|write|replace|patch|create/i.test(kind)) {
    const file = shortFileName(raw || kind);
    return { key: `edit:${file}`, label: `${file} 수정 및 구현` };
  }
  if (/grep|search|glob|find|list/i.test(kind)) {
    return { key: 'search:code', label: '관련 파일 및 구조 탐색' };
  }
  if (/bash|shell|run|exec|command/i.test(kind) || raw) {
    if (/cargo\s+test|npm\s+test|pytest|vitest|jest/i.test(raw)) {
      return { key: 'cmd:test', label: '테스트 실행 및 검증' };
    }
    if (/cargo\s+clippy|eslint|tsc|npm\s+run\s+build|cargo\s+check|cargo\s+build/i.test(raw)) {
      return { key: 'cmd:build', label: '빌드 및 정적 검사 확인' };
    }
    if (/git\s+(status|diff|log)/i.test(raw)) {
      return { key: 'cmd:git-check', label: 'Git 변경사항 확인' };
    }
    if (/git\s+(commit|push)/i.test(raw)) {
      return { key: 'cmd:git-push', label: '변경사항 커밋 및 반영' };
    }
    if (/^\/[\w./-]+$/.test(raw)) {
      const file = shortFileName(raw);
      return { key: `file:${file}`, label: `${file} 작업` };
    }
    const cleaned = raw
      .replace(/^export\s+PATH=[^;&]+\s*[;&]*\s*/i, '')
      .replace(/^cd\s+\S+\s*&&\s*/i, '')
      .trim();
    const shortCmd = cleaned.split(/\s+/).slice(0, 3).join(' ');
    if (shortCmd) {
      return { key: `cmd:${shortCmd}`, label: `${shortCmd} 실행` };
    }
  }
  return null;
}

/**
 * Extract markdown checklist todos (`- [ ]`, `- [/]`, `- [x]`) from assistant
 * messages or thinking text so agents that create a checklist at the start of
 * a task and check items off one by one drive the TodoBar directly.
 */
export function parseChecklistTodos(texts: string[], busy = false): TodoItem[] {
  const lineRe = /^\s*(?:[-*+]|\d+\.)\s*\[([ xX/~-])\]\s+(.+)$/;
  // Scan from the latest text block backwards; once we find texts in the current turn
  // that contain a checklist, merge them in chronological order so step updates
  // (- [ ] -> - [/] -> - [x]) within the active turn override earlier states cleanly.
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
 * Derive a clean, deduplicated, human-readable todo list from conversation
 * texts (preferring explicit markdown checklists) or tool steps.
 */
export function deriveTodosFromTools(
  tools: RawToolLike[],
  texts: string[] = [],
  busy = false,
): TodoItem[] {
  const checklist = parseChecklistTodos(texts, busy);
  if (checklist.length >= 2) return checklist.slice(0, 8);

  if (!tools.length) return checklist;

  const dedup = new Map<string, TodoItem>();
  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i];
    const step = humanizeToolStep(tool);
    if (!step) continue;
    const state = String(
      tool.status || tool.state || (tool.running ? 'running' : 'completed'),
    ).toLowerCase();
    const isRunning =
      Boolean(tool.running) ||
      state.includes('progress') ||
      state === 'running' ||
      state === 'pending';
    const existing = dedup.get(step.key);
    const nextStatus: TodoItem['status'] = isRunning
      ? 'in_progress'
      : busy && i === tools.length - 1
        ? 'in_progress'
        : 'completed';
    dedup.set(step.key, {
      id: existing?.id || tool.id || `step-${i}`,
      content: step.label,
      status: nextStatus === 'in_progress' ? 'in_progress' : 'completed',
    });
  }

  const list = [...dedup.values()].slice(-6);
  if (!busy) {
    for (const item of list) {
      if (item.status === 'in_progress') item.status = 'completed';
    }
  }
  return list;
}
