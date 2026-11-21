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
  const allDone = completed === todos.length;
  const title = inProgress?.content || (allDone ? '모두 끝났어요' : '진행 중');

  return (
    <div className={`todo-card ${open ? 'expanded' : ''}`}>
      <div className="todo-head">
        <button
          type="button"
          className="todo-summary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="todo-bars" aria-hidden="true">
            <i className={allDone ? 'done' : 'active'} />
            <i className={allDone ? 'done' : 'active'} />
            <i className={allDone ? 'done' : 'active'} />
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

/**
 * Derive a todo progress list from tool executions when an agent/CLI doesn't
 * emit an explicit structured `todowrite` list.
 */
export function deriveTodosFromTools(
  tools: { id?: string; name?: string; command?: string; detail?: string; status?: string; state?: string; running?: boolean }[],
): TodoItem[] {
  if (!tools.length) return [];
  const latest = tools.slice(-8);
  return latest.map((tool, index) => {
    const state = String(tool.status || tool.state || (tool.running ? 'running' : 'completed')).toLowerCase();
    const isRunning = tool.running || state.includes('progress') || state === 'running' || state === 'pending';
    const isFailed = state === 'failed' || state === 'error';
    const label = (tool.command || tool.detail || tool.name || '작업').replace(/\s+/g, ' ').trim();
    return {
      id: tool.id || `tool-${index}`,
      content: label.length > 72 ? `${label.slice(0, 72)}…` : label,
      status: isRunning ? 'in_progress' : isFailed ? 'cancelled' : 'completed',
    };
  });
}
