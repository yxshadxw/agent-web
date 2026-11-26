import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronUp, Loader2, Plus, Trash2, X } from 'lucide-react';

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
};

type ManualTodo = {
  id: string;
  content: string;
  status: 'pending' | 'completed';
  createdAt: number;
};

const MANUAL_TODO_PREFIX = 'agent-web:manual-todos:v1:';

function pulseRing(el: HTMLElement, color: string, spread = 12, ms = 700, strength = 0.6) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ring = document.createElement('span');
  ring.setAttribute('aria-hidden', 'true');
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: getComputedStyle(el).borderRadius,
    boxShadow: `0 0 0 2px ${color}`,
    pointerEvents: 'none',
    zIndex: '60',
    willChange: 'transform, opacity',
  });
  document.body.append(ring);
  const scaleX = (rect.width + spread * 2) / rect.width;
  const scaleY = (rect.height + spread * 2) / rect.height;
  const animation = ring.animate(
    [
      { transform: 'scale(1)', opacity: strength },
      { transform: `scale(${scaleX}, ${scaleY})`, opacity: 0 },
    ],
    { duration: ms, easing: 'ease-out' },
  );
  animation.onfinish = animation.oncancel = () => ring.remove();
}

function manualKey(storageKey?: string) {
  return `${MANUAL_TODO_PREFIX}${storageKey || 'default'}`;
}

function readManualTodos(storageKey?: string): ManualTodo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(manualKey(storageKey));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!content || content.length > 360) return [];
      return [
        {
          id:
            typeof record.id === 'string' && record.id
              ? record.id
              : `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          content,
          status: record.status === 'completed' ? 'completed' : 'pending',
          createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        } satisfies ManualTodo,
      ];
    });
  } catch {
    return [];
  }
}

function writeManualTodos(storageKey: string | undefined, todos: ManualTodo[]) {
  if (typeof window === 'undefined') return;
  try {
    const key = manualKey(storageKey);
    if (todos.length) window.localStorage.setItem(key, JSON.stringify(todos));
    else window.localStorage.removeItem(key);
  } catch {
    // Private browsing can reject storage; in-memory todos still work.
  }
}

export function TodoBar({
  todos,
  onToast,
  storageKey,
}: {
  todos: TodoItem[];
  onToast?: (message: string) => void;
  storageKey?: string;
}) {
  const [visible, setVisible] = useState(true);
  const [open, setOpen] = useState(false);
  const [manualTodos, setManualTodos] = useState<ManualTodo[]>(() =>
    readManualTodos(storageKey),
  );
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const writtenKeyRef = useRef(storageKey);
  const trayRef = useRef<HTMLDivElement>(null);
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const animatedOnce = useRef(false);

  useEffect(() => {
    setManualTodos(readManualTodos(storageKey));
    setDraft('');
    setOpen(false);
  }, [storageKey]);

  useEffect(() => {
    if (writtenKeyRef.current !== storageKey) {
      writtenKeyRef.current = storageKey;
      return;
    }
    writeManualTodos(storageKey, manualTodos);
  }, [manualTodos, storageKey]);

  const combined = useMemo<TodoItem[]>(
    () => [
      ...todos,
      ...manualTodos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      })),
    ],
    [manualTodos, todos],
  );

  useEffect(() => {
    if (combined.length > 0) setVisible(true);
  }, [combined.length]);

  const completed = combined.filter((todo) => todo.status === 'completed').length;
  const inProgress = combined.find((todo) => todo.status === 'in_progress');
  const pending = combined.find((todo) => todo.status === 'pending');
  const allDone = combined.length > 0 && completed === combined.length;
  const ratio = combined.length > 0 ? completed / combined.length : 0;
  const litCount = allDone ? 3 : ratio >= 0.66 ? 2 : 1;
  const title =
    combined.length === 0
      ? '할 일을 추가해 보세요'
      : inProgress?.content ||
        (allDone ? '모두 끝났어요' : pending?.content || '진행 중');

  // pi-oven's todo tray: a finished step pops and spreads a ring; when the last
  // step lands, the whole card boings once. Only the transition animates, not
  // a list re-read or a page reload.
  useEffect(() => {
    const next = new Map(combined.map((todo) => [todo.id, todo.status]));
    const finished = animatedOnce.current
      ? combined.filter(
          (todo) =>
            todo.status === 'completed' &&
            prevStatuses.current.has(todo.id) &&
            prevStatuses.current.get(todo.id) !== 'completed',
        )
      : [];
    prevStatuses.current = next;
    animatedOnce.current = true;
    if (!finished.length || !trayRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
      const tray = trayRef.current;
      if (!tray) return;
      if (allDone) {
        tray.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.035)', offset: 0.28 },
            { transform: 'scale(0.988)', offset: 0.52 },
            { transform: 'scale(1.01)', offset: 0.74 },
            { transform: 'scale(1)' },
          ],
          { duration: 700, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' },
        );
        pulseRing(tray, '#47d486', 12, 700, 0.55);
      }
      for (const todo of finished) {
        document
          .querySelectorAll<HTMLElement>(`[data-todo-seg="${CSS.escape(todo.id)}"]`)
          .forEach((element) => {
            element.animate(
              [
                { transform: 'scale(1)' },
                { transform: 'scale(1.7)', offset: 0.3 },
                { transform: 'scale(0.9)', offset: 0.6 },
                { transform: 'scale(1)' },
              ],
              { duration: 640, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' },
            );
            pulseRing(element, '#47d486', 8, 640, 0.6);
          });
      }
    });
  }, [allDone, combined]);

  const focusAdd = () => {
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 140);
  };

  if (!combined.length && !open) {
    return (
      <button
        type="button"
        className="todo-peek todo-launcher"
        onClick={focusAdd}
        aria-label="할 일 추가"
      >
        <span className="todo-bars" aria-hidden="true">
          <i className="dim" />
          <i className="dim" />
          <i className="dim" />
        </span>
        <span className="todo-peek-title">할 일 추가</span>
        <Plus size={14} />
      </button>
    );
  }

  const addManualTodo = () => {
    const content = draft.replace(/\s+/g, ' ').trim();
    if (!content) return;
    const next: ManualTodo = {
      id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      content: content.slice(0, 360),
      status: 'pending',
      createdAt: Date.now(),
    };
    setManualTodos((current) => [...current, next]);
    setDraft('');
    setOpen(true);
    onToast?.('할 일을 추가했어요');
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  const toggleManualTodo = (id: string) => {
    setManualTodos((current) =>
      current.map((todo) =>
        todo.id === id
          ? { ...todo, status: todo.status === 'completed' ? 'pending' : 'completed' }
          : todo,
      ),
    );
  };

  const removeManualTodo = (id: string) => {
    setManualTodos((current) => current.filter((todo) => todo.id !== id));
    onToast?.('할 일을 지웠어요');
  };

  const summaryBars = (
    <span className="todo-bars" aria-hidden="true">
      {[0, 1, 2].map((idx) => (
        <i
          key={idx}
          className={allDone ? 'done' : idx < litCount ? 'active' : 'dim'}
        />
      ))}
    </span>
  );

  if (!visible) {
    return (
      <button
        type="button"
        className={`todo-peek ${allDone ? 'is-done' : 'is-active'}`}
        onClick={() => setVisible(true)}
        aria-label="할 일 카드 다시 열기"
      >
        {summaryBars}
        <span className="todo-peek-title">{title}</span>
        <span className="todo-count">
          {completed} / {combined.length}
        </span>
        <ChevronUp size={14} className="chev" />
      </button>
    );
  }

  return (
    <div
      ref={trayRef}
      className={`todo-card ${open ? 'expanded' : ''} ${allDone ? 'is-done' : 'is-active'}`}
    >
      <div className="todo-head">
        <button
          type="button"
          className="todo-summary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {summaryBars}
          <span className="todo-title">{title}</span>
          <span className="todo-count">
            {completed} / {combined.length}
          </span>
        </button>
        <button
          type="button"
          className="todo-mini"
          onClick={focusAdd}
          aria-label="할 일 추가"
          title="할 일 추가"
        >
          <Plus size={16} />
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
            setOpen(false);
            onToast?.('할 일 카드를 숨겼어요');
          }}
          aria-label="할 일 카드 닫기"
        >
          <X size={16} />
        </button>
      </div>
      <span className="todo-progress" aria-hidden="true">
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      <div className="todo-body">
        <div className="todo-body-inner">
          <ul>
            {todos.map((todo) => (
              <li key={todo.id} className={`todo-item status-${todo.status}`}>
                <span className={`todo-check status-${todo.status}`} data-todo-seg={todo.id}>
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
            {manualTodos.length > 0 && (
              <li className="todo-section-label">
                내 할 일
                <span>{manualTodos.length}</span>
              </li>
            )}
            {manualTodos.map((todo) => (
              <li key={todo.id} className={`todo-item manual status-${todo.status}`}>
                <button
                  type="button"
                  className={`todo-check status-${todo.status}`}
                  data-todo-seg={todo.id}
                  onClick={() => toggleManualTodo(todo.id)}
                  aria-label={
                    todo.status === 'completed'
                      ? `${todo.content} 완료 취소`
                      : `${todo.content} 완료`
                  }
                >
                  {todo.status === 'completed' ? (
                    <Check size={11} strokeWidth={3} />
                  ) : null}
                </button>
                <span>{todo.content}</span>
                <button
                  type="button"
                  className="todo-remove"
                  onClick={() => removeManualTodo(todo.id)}
                  aria-label={`${todo.content} 삭제`}
                  title="할 일 삭제"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="todo-add-row">
            <Plus size={13} />
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                event.stopPropagation();
                addManualTodo();
              }}
              placeholder="할 일 추가 후 Enter"
              maxLength={360}
              aria-label="새 할 일"
            />
            <button
              type="button"
              className="todo-add-btn"
              onClick={addManualTodo}
              disabled={!draft.trim()}
            >
              추가
            </button>
          </div>
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

type StructuredTodo = { content: string; status?: string };

function todoStatus(value?: string): TodoItem['status'] {
  const status = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (/complete|done|finish|success/.test(status)) return 'completed';
  if (/progress|active|running|doing|working/.test(status)) return 'in_progress';
  if (/cancel|skip|abort|drop/.test(status)) return 'cancelled';
  return 'pending';
}

function structuredTodosFromTool(tool: RawToolLike): StructuredTodo[] | null {
  const raw = String(tool.command || tool.detail || '').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = parsed as { todos?: unknown[]; items?: unknown[] };
    const isTodoTool = /todo/i.test(String(tool.tool || tool.name || tool.label || ''));
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(record.todos)
        ? record.todos
        : isTodoTool && Array.isArray(record.items)
          ? record.items
          : null;
    if (!list) return null;
    const todos = list.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      const content = [entry.content, entry.text, entry.title, entry.todo, entry.task].find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
      if (!content) return [];
      return [
        {
          content: content.trim().slice(0, 360),
          status: typeof entry.status === 'string' ? entry.status : undefined,
        },
      ];
    });
    return todos.length ? todos : null;
  } catch {
    return null;
  }
}

/** Read the latest structured `write_todos` / `todowrite` payload. */
export function parseStructuredTodos(tools: RawToolLike[]): TodoItem[] {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const parsed = structuredTodosFromTool(tools[index]);
    if (!parsed) continue;
    return parsed.map((todo, todoIndex) => ({
      id: `struct-${todoIndex}-${todo.content.slice(0, 24)}`,
      content: todo.content,
      status: todoStatus(todo.status),
    }));
  }
  return [];
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
  const structured = parseStructuredTodos(tools);
  if (structured.length > 0) {
    if (busy && !structured.some((item) => item.status === 'in_progress')) {
      const firstPending = structured.find((item) => item.status === 'pending');
      if (firstPending) firstPending.status = 'in_progress';
    }
    return structured;
  }

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
