import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ShieldQuestion,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { formatTokens } from '../data';
import { switchEngine, type AgentEngine } from '../lib/engine';
import { BrandGlyph } from './Brand';
import { AutoList } from './Sheets';
import { SelectMenu } from './SelectMenu';

type CodexTool = {
  id?: string;
  type: string;
  name?: string;
  command?: string;
  status?: string;
  output?: string;
};

type CodexMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  tools?: CodexTool[];
  duration?: number;
  model?: string;
  effort?: string;
  at: number;
};

type CodexUsage = {
  turns: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  context: number;
  contextWindow: number;
};

type CodexQuotaWindow = {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type CodexQuota = {
  ok?: boolean;
  plan?: string | null;
  primary?: CodexQuotaWindow | null;
  secondary?: CodexQuotaWindow | null;
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null } | null;
  ordinaryUsageAllowed?: boolean | null;
  fetchedAt?: number;
  error?: string;
};

type StoredChat = {
  threadId: string;
  messages: CodexMessage[];
  usage?: CodexUsage | null;
  model?: string;
  effort?: string;
  autoApprove?: boolean;
};

const STORAGE_KEY = 'agent-web:codex-panel:v1';
const CONTEXT_WINDOW = 272_000;
const CODEX_MODELS = [
  { value: '', label: 'CLI 기본', description: 'Codex 설정값', meta: '자동' },
  { value: 'gpt-6-luna', label: 'GPT-6 Luna', description: '범용 코딩 · 현재 CLI 기본', meta: '272k' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: '긴 작업 · 최대 effort', meta: '272k' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: '빠른 코딩', meta: '272k' },
];
const CODEX_EFFORTS = [
  { value: 'low', label: 'Low', description: '빠른 응답', meta: 'light' },
  { value: 'medium', label: 'Medium', description: '일반 작업', meta: '기본' },
  { value: 'high', label: 'High', description: '복잡한 작업', meta: 'deep' },
  { value: 'xhigh', label: 'XHigh', description: '깊은 추론', meta: 'deeper' },
  { value: 'max', label: 'Max', description: '가장 깊은 추론', meta: 'max' },
  { value: 'ultra', label: 'Ultra', description: 'Terra 전용', meta: 'ultra' },
];

function CodexMarkdown({
  text,
  className = 'codex-md',
}: {
  text: string;
  className?: string;
}) {
  const html = marked.parse(text, { gfm: true, breaks: true }) as string;
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input'] }),
      }}
    />
  );
}

function codexToolDisplay(tool: CodexTool) {
  const kind = `${tool.type} ${tool.name || ''}`.toLowerCase();
  if (
    kind.includes('command') ||
    kind.includes('bash') ||
    kind.includes('shell') ||
    kind.includes('exec')
  ) {
    return { kind: 'bash', label: 'bash', Icon: Terminal };
  }
  if (
    kind.includes('file_change') ||
    kind.includes('edit') ||
    kind.includes('write') ||
    kind.includes('patch')
  ) {
    return { kind: 'write', label: 'edit', Icon: Save };
  }
  if (kind.includes('web') || kind.includes('search') || kind.includes('fetch')) {
    return { kind: 'web', label: 'web', Icon: Search };
  }
  if (kind.includes('read') || kind.includes('file') || kind.includes('mcp')) {
    return { kind: 'read', label: 'read', Icon: FileText };
  }
  return { kind: 'tool', label: 'tool', Icon: Wrench };
}

function CodexThinking({ text, busy = false }: { text: string; busy?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="thinking codex-agy-thinking">
      <button
        type="button"
        className="thinking-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={15} className="chev open" />
        ) : (
          <ChevronRight size={15} className="chev" />
        )}
        <span>생각</span>
        {busy && <span className="thinking-live" />}
      </button>
      {open && (
        <div className="thinking-body reasoning-body">
          <CodexMarkdown text={text} className="md" />
        </div>
      )}
    </div>
  );
}

function CodexToolRow({ tool }: { tool: CodexTool }) {
  const meta = codexToolDisplay(tool);
  const state = String(tool.status || 'completed').toLowerCase();
  const running = state.includes('progress') || state === 'running' || state === 'pending';
  const failed = state === 'failed' || state === 'error';
  const label = running ? '실행 중' : failed ? '실패' : '완료';
  const Icon = meta.Icon;
  const command = tool.command || tool.name || tool.type;

  return (
    <details className={`tool real codex-agy-tool ${failed ? 'failed' : ''}`} open={failed || undefined}>
      <summary className="tool-main">
        <span className={`tool-status ${running ? 'running' : failed ? 'error' : 'done'}`}>
          {running ? (
            <Loader2 size={13} className="spin" />
          ) : failed ? (
            <X size={13} />
          ) : (
            <Check size={13} strokeWidth={3} />
          )}
        </span>
        <span className={`tool-ico kind-${meta.kind}`}>
          <Icon size={14} />
        </span>
        <span className="tool-kind">{meta.label}</span>
        <span className="tool-name" title={command}>{command}</span>
        <span className="tool-time">{label}</span>
        <ChevronDown size={14} className="tool-chev" />
      </summary>
      <div className="tool-detail">
        <div className="tool-detail-label">{tool.type || 'CODEX TOOL'}</div>
        <pre className="tool-args">{command}</pre>
        {tool.output && (
          <>
            <div className="tool-detail-label">OUTPUT</div>
            <pre className="tool-args tool-output">{tool.output}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function loadStored(): StoredChat {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { threadId: '', messages: [] };
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
      return {
      threadId: typeof parsed.threadId === 'string' ? parsed.threadId : '',
      usage: parsed.usage && typeof parsed.usage === 'object' ? (parsed.usage as CodexUsage) : null,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      effort: typeof parsed.effort === 'string' ? parsed.effort : 'medium',
      autoApprove: Boolean(parsed.autoApprove),
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message): message is CodexMessage =>
              Boolean(
                message &&
                  typeof message.id === 'string' &&
                  (message.role === 'user' || message.role === 'assistant') &&
                  typeof message.text === 'string',
              ),
          )
        : [],
    };
  } catch {
    return { threadId: '', messages: [] };
  }
}

export function CodexPanel({
  onClose,
  standalone = false,
  embedded = false,
  statsOpen,
  onStatsOpen,
  resetKey,
}: {
  onClose?: () => void;
  standalone?: boolean;
  embedded?: boolean;
  statsOpen?: boolean;
  onStatsOpen?: (open: boolean) => void;
  resetKey?: number;
}) {
  const initial = useRef(loadStored());
  const [messages, setMessages] = useState<CodexMessage[]>(initial.current.messages);
  const [threadId, setThreadId] = useState(initial.current.threadId);
  const [usage, setUsage] = useState<CodexUsage | null>(initial.current.usage ?? null);
  const [model, setModel] = useState(initial.current.model ?? '');
  const [effort, setEffort] = useState(initial.current.effort ?? 'medium');
  const [autoApprove, setAutoApprove] = useState(Boolean(initial.current.autoApprove));
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<'model' | 'effort' | null>(null);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [statsClosing, setStatsClosing] = useState(false);
  const [permissionClosing, setPermissionClosing] = useState(false);
  const [quota, setQuota] = useState<CodexQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [localStatsOpen, setLocalStatsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);
  const lastResetKey = useRef(resetKey ?? 0);
  const statsVisible = statsOpen ?? localStatsOpen;
  const setStats = (open: boolean) => {
    if (onStatsOpen) onStatsOpen(open);
    else setLocalStatsOpen(open);
  };
  const threadRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const settingsTimerRef = useRef<number | undefined>(undefined);
  const statsTimerRef = useRef<number | undefined>(undefined);
  const permissionTimerRef = useRef<number | undefined>(undefined);
  const generationRef = useRef(0);
  const contextPct =
    usage && usage.contextWindow
      ? Math.min(100, Math.max(0, (usage.context / usage.contextWindow) * 100))
      : 0;
  const remainingContext = usage
    ? Math.max(0, usage.contextWindow - usage.context)
    : CONTEXT_WINDOW;
  const selectedModel = CODEX_MODELS.find((option) => option.value === model) || CODEX_MODELS[0];
  const selectedEffort = CODEX_EFFORTS.find((option) => option.value === effort) || CODEX_EFFORTS[1];
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const dismissSettings = () => {
    window.clearTimeout(settingsTimerRef.current);
    setSettingsClosing(false);
    setSettingsPanel(null);
  };

  const openSettings = (panel: 'model' | 'effort') => {
    window.clearTimeout(settingsTimerRef.current);
    setSettingsClosing(false);
    setSettingsPanel(panel);
  };

  const closeSettings = () => {
    if (!settingsPanel) return;
    window.clearTimeout(settingsTimerRef.current);
    setSettingsClosing(true);
    settingsTimerRef.current = window.setTimeout(() => {
      setSettingsPanel(null);
      setSettingsClosing(false);
    }, 260);
  };

  const toggleSettings = (panel: 'model' | 'effort') => {
    if (settingsPanel === panel && !settingsClosing) closeSettings();
    else openSettings(panel);
  };

  const openStats = () => {
    window.clearTimeout(statsTimerRef.current);
    setStatsClosing(false);
    setStats(true);
  };

  const closeStats = () => {
    if (!statsVisible || statsClosing) return;
    window.clearTimeout(statsTimerRef.current);
    setStatsClosing(true);
    statsTimerRef.current = window.setTimeout(() => {
      setStats(false);
      setStatsClosing(false);
    }, 260);
  };

  const openPermission = () => {
    window.clearTimeout(permissionTimerRef.current);
    setPermissionClosing(false);
    setPermissionOpen(true);
  };

  const closePermission = () => {
    if (!permissionOpen || permissionClosing) return;
    window.clearTimeout(permissionTimerRef.current);
    setPermissionClosing(true);
    permissionTimerRef.current = window.setTimeout(() => {
      setPermissionOpen(false);
      setPermissionClosing(false);
    }, 260);
  };

  const loadQuota = () => {
    setQuotaLoading(true);
    setQuotaError(null);
    fetch('/codex-api/quota', { credentials: 'include' })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as CodexQuota;
        if (!response.ok || body.ok === false) {
          throw new Error(body.error || `Codex 한도 요청 실패 (${response.status})`);
        }
        setQuota(body);
      })
      .catch((cause) => {
        setQuotaError(cause instanceof Error ? cause.message : 'Codex 계정 한도를 읽지 못했어요.');
      })
      .finally(() => setQuotaLoading(false));
  };

  useEffect(() => {
    if (statsVisible) loadQuota();
    // Only refresh when the sheet is opened, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsVisible]);

  useEffect(() => {
    if (resetKey === undefined || resetKey === lastResetKey.current) return;
    lastResetKey.current = resetKey;
    generationRef.current += 1;
    window.clearInterval(timerRef.current);
    setMessages([]);
    setThreadId('');
    setUsage(null);
    setDraft('');
    setError(null);
    window.clearTimeout(settingsTimerRef.current);
    window.clearTimeout(statsTimerRef.current);
    window.clearTimeout(permissionTimerRef.current);
    setBusy(false);
    setStats(false);
    setStatsClosing(false);
    setSettingsClosing(false);
    setSettingsPanel(null);
    setPermissionClosing(false);
    setPermissionOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  }, [resetKey]);

  const quotaWindows = [
    { label: '5시간', window: quota?.primary },
    { label: '주간', window: quota?.secondary },
  ].filter((entry) => entry.window);

  const quotaLabel = (window?: CodexQuotaWindow | null) => {
    if (!window?.windowDurationMins) return '계정 한도';
    const mins = window.windowDurationMins;
    if (mins >= 10_080) return mins % 1_440 === 0 ? `${mins / 1_440}일` : `${Math.round(mins / 1_440)}일`;
    if (mins >= 60) return `${Math.round(mins / 60)}시간`;
    return `${mins}분`;
  };

  const resetLabel = (window?: CodexQuotaWindow | null) => {
    if (!window?.resetsAt) return '초기화 시각 없음';
    return `${new Date(window.resetsAt * 1000).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })} 초기화`;
  };

  useEffect(
    () => () => {
      window.clearTimeout(settingsTimerRef.current);
      window.clearTimeout(statsTimerRef.current);
      window.clearTimeout(permissionTimerRef.current);
      window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ threadId, messages, usage, model, effort, autoApprove }),
      );
    } catch {
      // A full localStorage should not break the chat.
    }
  }, [messages, threadId, usage, model, effort, autoApprove]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, error]);

  const copyMessage = async (message: CodexMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessage(message.id);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedMessage(null), 1400);
    } catch {
      // clipboard can fail silently
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (settingsPanel) {
        if (!settingsClosing) closeSettings();
        return;
      }
      if (statsVisible || permissionOpen) {
        setStats(false);
        setPermissionOpen(false);
        return;
      }
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearInterval(timerRef.current);
    };
  }, [onClose, permissionOpen, settingsClosing, settingsPanel, statsVisible]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((current) => [
      ...current,
      { id: `u_${Date.now().toString(36)}`, role: 'user', text: prompt, at: Date.now() },
    ]);
    setDraft('');
    setError(null);
    setBusy(true);
    setElapsed(0);
    const started = Date.now();
    window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);

    try {
      const response = await fetch('/codex-api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ prompt, threadId, model, effort, autoApprove }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        reasoning?: string;
        tools?: CodexTool[];
        threadId?: string;
        usage?: Record<string, number>;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Codex 요청에 실패했어요 (${response.status})`);
      }
      if (generation !== generationRef.current) return;
      if (data.threadId) setThreadId(data.threadId);
      if (data.usage) {
        const turnInput = Number(data.usage.input_tokens) || 0;
        const turnCached = Number(data.usage.cached_input_tokens) || 0;
        const turnOutput = Number(data.usage.output_tokens) || 0;
        const turnReasoning = Number(data.usage.reasoning_output_tokens) || 0;
        setUsage((current) => ({
          turns: (current?.turns || 0) + 1,
          input: (current?.input || 0) + turnInput,
          cached: (current?.cached || 0) + turnCached,
          output: (current?.output || 0) + turnOutput,
          reasoning: (current?.reasoning || 0) + turnReasoning,
          context: turnInput,
          contextWindow: CONTEXT_WINDOW,
        }));
      }
      setMessages((current) => [
        ...current,
        {
          id: `a_${Date.now().toString(36)}`,
          role: 'assistant',
          text: data.text || 'Codex 응답이 비어 있어요.',
          reasoning: data.reasoning || '',
          tools: Array.isArray(data.tools) ? data.tools : [],
          duration: Math.max(0, Math.round((Date.now() - started) / 1000)),
          model: selectedModel.label,
          effort: selectedEffort.label,
          at: Date.now(),
        },
      ]);
    } catch (cause) {
      if (generation === generationRef.current) {
        setError(cause instanceof Error ? cause.message : 'Codex에 연결하지 못했어요.');
      }
    } finally {
      window.clearInterval(timerRef.current);
      if (abortRef.current === controller) abortRef.current = null;
      if (generation === generationRef.current) setBusy(false);
    }
  };

  const abort = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    window.clearInterval(timerRef.current);
    setBusy(false);
  };

  const reset = () => {
    if (busy) return;
    generationRef.current += 1;
    window.clearInterval(timerRef.current);
    setMessages([]);
    setThreadId('');
    setUsage(null);
    setDraft('');
    setError(null);
    window.clearTimeout(settingsTimerRef.current);
    window.clearTimeout(statsTimerRef.current);
    window.clearTimeout(permissionTimerRef.current);
    setStats(false);
    setStatsClosing(false);
    setPermissionClosing(false);
    setSettingsClosing(false);
    setSettingsPanel(null);
    setPermissionOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const panel = (
      <section
        className={`codex-panel ${embedded ? 'codex-embedded' : ''} ${standalone ? 'codex-standalone' : ''}`}
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-label="Codex"
      >
        {!embedded && (
        <header className="codex-head">
          <span className="codex-mark">
            <Bot size={18} />
          </span>
          <div className="codex-title">
            <strong>Codex</strong>
            <span>OpenAI CLI · 초기 화면에서 바로 실행</span>
          </div>
          <span className={`codex-live ${busy ? 'busy' : ''}`}>
            <i />
            {busy ? '작업 중' : '준비됨'}
          </span>
          {standalone && (
            <SelectMenu
              className="codex-engine-select"
              value="codex"
              onChange={(next) => switchEngine(next as AgentEngine)}
              ariaLabel="에이전트 엔진 전환"
              options={[
                { value: 'codex', label: 'Codex', description: '이 화면' },
                { value: 'opencode', label: 'OpenCode', description: '메인 에이전트' },
                { value: 'agy', label: 'Agy', description: 'Google 에이전트' },
              ]}
            />
          )}
          <button className="codex-icon" onClick={reset} disabled={busy} title="새 대화">
            <Plus size={16} />
          </button>
          {onClose && (
            <button className="codex-icon" onClick={onClose} aria-label="Codex 닫기">
              <X size={18} />
            </button>
          )}
        </header>
        )}

        <div className="codex-thread codex-agy-thread" ref={threadRef}>
          {messages.length === 0 && !busy && (
            <div className="empty-state codex-initial">
              <div className="empty-mark">
                <BrandGlyph />
              </div>
              <h2>무엇을 도와드릴까요?</h2>
              <p>
                메시지를 보내면 실제 Codex 에이전트가 이 워크트리를 읽고,
                실행하고, 파일을 수정합니다.
              </p>
              <div className="empty-suggestions">
                {[
                  '이 프로젝트 구조를 파악해서 요약해줘',
                  '테스트를 실행하고 실패한 부분을 고쳐줘',
                  '최근 변경사항을 리뷰하고 개선점을 알려줘',
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    className="empty-suggestion"
                    onClick={() => setDraft(text)}
                  >
                    <span>{text}</span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
              <div className="empty-hint">
                <Terminal size={13} /> Enter로 전송 · Shift+Enter로 줄바꿈
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === 'user') {
              return (
                <div className="bubble-row user codex-agy-user" key={message.id}>
                  <div className="bubble user">{message.text}</div>
                </div>
              );
            }
            const meta = [
              message.model || selectedModel.label,
              message.effort || selectedEffort.label,
              message.duration ? `${message.duration}초` : '',
              new Date(message.at).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }),
            ].filter(Boolean);
            return (
              <article className="codex-agy-turn" key={message.id}>
                {message.reasoning && <CodexThinking text={message.reasoning} />}
                {message.tools && message.tools.length > 0 && (
                  <div className="tools codex-agy-tools">
                    {message.tools.map((tool, index) => (
                      <CodexToolRow
                        key={`${message.id}-${tool.id || tool.type}-${index}`}
                        tool={tool}
                      />
                    ))}
                  </div>
                )}
                <div className="assistant-text">
                  <CodexMarkdown text={message.text} className="md" />
                </div>
                <div className="msg-meta">
                  <div className="meta-actions">
                    <button
                      type="button"
                      className="meta-btn"
                      onClick={() => void copyMessage(message)}
                      aria-label={copiedMessage === message.id ? '복사됨' : '응답 복사'}
                    >
                      {copiedMessage === message.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <span className="meta-time">{meta.join(' · ')}</span>
                </div>
              </article>
            );
          })}

          {busy && (
            <div className="bubble-row agent bubble-in codex-agy-typing" role="status">
              <span className="agent-dot" />
              <div className="bubble agent typing">
                <Loader2 size={14} className="spin" />
                <span>생각하는 중…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="codex-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {statsVisible && (
          <div
            className={`inline-panel codex-usage-panel ${statsClosing ? 'is-collapsing' : ''}`}
            role="dialog"
            aria-label="Codex 사용량과 컨텍스트"
            aria-hidden={statsClosing || undefined}
          >
            <div className="inline-panel-scroll">
              <div className="sheet-content usage-sheet">
                <div className="sheet-head">
                  <span className="sheet-title">사용량 한도</span>
                  <span className="sheet-sub">{selectedModel.label}</span>
                  <button
                    type="button"
                    className="sheet-close"
                    onClick={closeStats}
                    aria-label="사용량 패널 닫기"
                  >
                    <X size={15} />
                  </button>
                </div>
                <section className="quota-section" aria-label="Codex 계정 한도">
                  <div className="quota-head">
                    <div className="quota-heading">
                      <Gauge size={15} />
                      <div>
                        <div className="quota-title">Codex 계정</div>
                        <div className="quota-caption">
                          ChatGPT {quota?.plan || 'plan'} · 실제 계정 한도
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="quota-refresh"
                      onClick={loadQuota}
                      disabled={quotaLoading}
                      aria-label="Codex 계정 한도 새로고침"
                    >
                      <RefreshCw size={13} className={quotaLoading ? 'spin' : ''} />
                    </button>
                  </div>
                  {quotaLoading && !quota ? (
                    <div className="quota-loading">
                      <Loader2 size={14} className="spin" />
                      Codex 계정 한도를 확인하는 중…
                    </div>
                  ) : quotaError ? (
                    <div className="quota-error">
                      <span>{quotaError}</span>
                      <button type="button" onClick={loadQuota}>다시 확인</button>
                    </div>
                  ) : quotaWindows.length > 0 ? (
                    <article className="quota-card">
                      {quotaWindows.map((entry) => {
                        const window = entry.window as CodexQuotaWindow;
                        const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
                        return (
                          <div className="quota-window" key={entry.label}>
                            <div className="quota-group-head">
                              <span className="quota-group-name">
                                {quotaLabel(window) || entry.label}
                              </span>
                              <span className="quota-group-meta">
                                {quota?.plan ? `ChatGPT ${quota.plan}` : 'ChatGPT'}
                              </span>
                            </div>
                            <div className="quota-line">
                              <span>남은 한도</span>
                              <strong>{remaining}%</strong>
                            </div>
                            <div className="bar quota-bar">
                              <span
                                className="bar-fill"
                                style={{ width: `${remaining}%` }}
                              />
                            </div>
                            <div className="quota-reset">
                              {window.usedPercent}% 사용 · {resetLabel(window)}
                            </div>
                          </div>
                        );
                      })}
                    </article>
                  ) : (
                    <div className="quota-empty">
                      Codex CLI가 계정 한도 창을 반환하지 않았어요.
                    </div>
                  )}
                  <div className="quota-foot">
                    Codex app-server의 account/rateLimits/read에서 읽은 실제 계정 한도입니다.
                  </div>
                </section>
                <section className="quota-section" aria-label="Codex 컨텍스트">
                  <div className="quota-head">
                    <div className="quota-heading">
                      <Gauge size={15} />
                      <div>
                        <div className="quota-title">컨텍스트</div>
                        <div className="quota-caption">CLI · 272k 컨텍스트</div>
                      </div>
                    </div>
                  </div>
                  <article className="quota-card">
                    <div className="quota-group-head">
                      <span className="quota-group-name">컨텍스트</span>
                      <span className="quota-group-meta">
                        {usage
                          ? `${formatTokens(usage.context)} / ${formatTokens(usage.contextWindow)}`
                          : '턴 후 표시'}
                      </span>
                    </div>
                    <div className="quota-window">
                      <div className="quota-line">
                        <span>사용</span>
                        <strong>{usage ? `${Math.round(contextPct)}%` : '—'}</strong>
                      </div>
                      <div className="bar quota-bar">
                        <span className="bar-fill" style={{ width: `${contextPct}%` }} />
                      </div>
                      <div className="quota-reset">
                        {usage
                          ? `${formatTokens(remainingContext)} 남음`
                          : '한 번 대화하면 컨텍스트가 표시됩니다.'}
                      </div>
                    </div>
                  </article>
                </section>
                <div className="usage-divider">
                  <span>이 세션</span>
                  <span>입력·출력 토큰</span>
                </div>
                <div className="usage-grid">
                  <div className="usage-cell sheet-anim">
                    <div className="usage-title">
                      <span className="status-dot green" />
                      입력
                    </div>
                    <div className="usage-big">{formatTokens(usage?.input ?? 0)}</div>
                    <div className="usage-sub">캐시 {formatTokens(usage?.cached ?? 0)} 포함</div>
                  </div>
                  <div className="usage-cell sheet-anim">
                    <div className="usage-title">
                      <span className="status-dot amber" />
                      출력
                    </div>
                    <div className="usage-big">{formatTokens(usage?.output ?? 0)}</div>
                    <div className="usage-sub">추론 {formatTokens(usage?.reasoning ?? 0)}</div>
                  </div>
                </div>
                <div className="usage-list sheet-anim">
                  <div>
                    <span>모델</span>
                    <strong>{selectedModel.label}</strong>
                  </div>
                  <div>
                    <span>Effort</span>
                    <strong>{effort}</strong>
                  </div>
                  <div>
                    <span>턴</span>
                    <strong>{usage?.turns ?? 0}개</strong>
                  </div>
                  <div>
                    <span>남은 컨텍스트</span>
                    <strong>{formatTokens(remainingContext)}</strong>
                  </div>
                  <div>
                    <span>비용</span>
                    <strong>CLI 구독</strong>
                  </div>
                </div>
                <button className="wide-btn sheet-anim" onClick={closeStats}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {permissionOpen && !statsVisible && (
          <div
            className={`inline-panel codex-permission-panel ${permissionClosing ? 'is-collapsing' : ''}`}
            role="dialog"
            aria-label="Codex 권한 설정"
            aria-hidden={permissionClosing || undefined}
          >
            <div className="inline-panel-scroll">
              <AutoList
                value={autoApprove}
                onPick={(auto) => {
                  setAutoApprove(auto);
                  closePermission();
                }}
              />
            </div>
          </div>
        )}

        <div className={`codex-compose ${settingsPanel ? 'settings-open' : ''}`}>
          {settingsPanel && !statsVisible && !permissionOpen && (
            <div
              className={`inline-panel codex-settings-panel ${settingsClosing ? 'is-closing' : ''}`}
              role="region"
              aria-label={settingsPanel === 'model' ? 'Codex 모델 선택' : 'Codex 추론 강도 선택'}
              aria-hidden={settingsClosing || undefined}
            >
              <div className="inline-panel-scroll">
                {settingsPanel === 'model' ? (
                  <div className="sheet-content model-sheet">
                    <div className="sheet-head">
                      <span className="sheet-title">모델</span>
                      <span className="sheet-sub">Codex CLI</span>
                    </div>
                    <div className="sheet-list">
                      {CODEX_MODELS.map((option) => (
                        <button
                          type="button"
                          key={option.value || 'default'}
                          className={`sheet-row model-row ${option.value === model ? 'selected' : ''}`}
                          onClick={() => {
                            setModel(option.value);
                            closeSettings();
                          }}
                        >
                          <span className="model-name">{option.label}</span>
                          <span className="row-provider">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="sheet-content reason-sheet">
                    <div className="sheet-head">
                      <span className="sheet-title">추론 강도</span>
                      <span className="sheet-sub">Effort</span>
                    </div>
                    <div className="sheet-list">
                      {CODEX_EFFORTS.map((option) => (
                        <button
                          type="button"
                          key={option.value}
                          className={`sheet-row reason-row ${option.value === effort ? 'selected' : ''}`}
                          onClick={() => {
                            setEffort(option.value);
                            closeSettings();
                          }}
                        >
                          <span className="reason-name">{option.label}</span>
                          <span className="row-provider">{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <form className="composer" onSubmit={(event) => void send(event)}>
              <button
                type="button"
                className="plus-btn"
                title="Codex 입력은 텍스트만 지원합니다"
                aria-label="텍스트 입력 안내"
                onClick={() => setError('Codex에는 텍스트 프롬프트만 보낼 수 있어요.')}
              >
                <Plus size={19} />
              </button>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Codex에게 메시지를 입력하세요"
                rows={1}
                aria-label="Codex 메시지 입력"
              />
              <button
                className={`send-btn ${busy ? 'stopping' : draft.trim() ? 'ready' : ''}`}
                type={busy ? 'button' : 'submit'}
                onClick={busy ? abort : undefined}
                disabled={!busy && !draft.trim()}
                aria-label={busy ? 'Codex 작업 중단' : 'Codex에 전송'}
              >
                {busy ? (
                  <Square size={13} fill="currentColor" />
                ) : (
                  <ArrowUp size={17} strokeWidth={2.4} />
                )}
              </button>
          </form>
          <div className="toolbar">
            <button
              type="button"
              className={`tb-item ${autoApprove ? 'approved' : ''} ${permissionOpen ? 'is-open' : ''}`}
              onClick={() => {
                setStats(false);
                setStatsClosing(false);
                dismissSettings();
                if (permissionOpen) closePermission();
                else openPermission();
              }}
              title={autoApprove ? '권한 요청을 자동으로 허용해요' : '권한 요청을 직접 확인해요'}
              aria-expanded={permissionOpen}
            >
              {autoApprove ? <ShieldCheck size={14} /> : <ShieldQuestion size={14} />}
              <span>{autoApprove ? '자동' : '확인'}</span>
              <ChevronDown size={12} className={`tb-chev ${permissionOpen ? 'flip' : ''}`} />
            </button>
            <div className="tb-center">
              <button
                type="button"
                className={`tb-item model ${settingsPanel === 'model' ? 'is-open' : ''}`}
                onClick={() => {
                  setStats(false);
                  setPermissionOpen(false);
                  toggleSettings('model');
                }}
                aria-expanded={settingsPanel === 'model'}
              >
                <span>{selectedModel.label}</span>
                <ChevronDown
                  size={12}
                  className={`tb-chev ${settingsPanel === 'model' ? 'flip' : ''}`}
                />
              </button>
              <button
                type="button"
                className={`tb-item ${settingsPanel === 'effort' ? 'is-open' : ''}`}
                onClick={() => {
                  setStats(false);
                  setPermissionOpen(false);
                  toggleSettings('effort');
                }}
                aria-expanded={settingsPanel === 'effort'}
              >
                <span>{selectedEffort.value}</span>
                <ChevronDown
                  size={12}
                  className={`tb-chev ${settingsPanel === 'effort' ? 'flip' : ''}`}
                />
              </button>
            </div>
            <button
              type="button"
              className={`tb-item timer ${busy ? 'busy' : 'idle'} ${statsVisible ? 'is-open' : ''}`}
              onClick={() => {
                setPermissionOpen(false);
                setPermissionClosing(false);
                dismissSettings();
                if (statsVisible) closeStats();
                else openStats();
              }}
              title="Codex 사용량과 컨텍스트"
              aria-label={statsVisible ? 'Codex 사용량 닫기' : 'Codex 사용량과 컨텍스트'}
            >
              <span
                className="timer-ring"
                title={`컨텍스트 ${Math.round(contextPct)}%`}
                style={{
                  background: `conic-gradient(#f2763a 0 ${contextPct}%, #35251e ${contextPct}% 360deg)`,
                }}
              />
              <span>{elapsedLabel}</span>
            </button>
          </div>
        </div>
      </section>
  );

  if (embedded) {
    return panel;
  }

  if (standalone) {
    return <div className="codex-stage">{panel}</div>;
  }

  return createPortal(
    <div className="codex-layer">
      <div className="codex-backdrop" onClick={onClose} />
      {panel}
    </div>,
    document.body,
  );
}
