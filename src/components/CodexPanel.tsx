import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ChevronRight,
  Gauge,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  Terminal,
  X,
} from 'lucide-react';
import { formatTokens } from '../data';
import { switchEngine, type AgentEngine } from '../lib/engine';
import { BrandGlyph } from './Brand';
import { AutoList } from './Sheets';
import { SelectMenu } from './SelectMenu';

type CodexMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
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

function CodexMarkdown({ text }: { text: string }) {
  const html = marked.parse(text, { gfm: true, breaks: true }) as string;
  return (
    <div
      className="codex-md"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input'] }),
      }}
    />
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
}: {
  onClose?: () => void;
  standalone?: boolean;
  embedded?: boolean;
  statsOpen?: boolean;
  onStatsOpen?: (open: boolean) => void;
}) {
  const initial = useRef(loadStored());
  const [messages, setMessages] = useState<CodexMessage[]>(initial.current.messages);
  const [threadId, setThreadId] = useState(initial.current.threadId);
  const [usage, setUsage] = useState<CodexUsage | null>(initial.current.usage ?? null);
  const [model, setModel] = useState(initial.current.model ?? '');
  const [effort, setEffort] = useState(initial.current.effort ?? 'medium');
  const [autoApprove, setAutoApprove] = useState(Boolean(initial.current.autoApprove));
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [localStatsOpen, setLocalStatsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const statsVisible = statsOpen ?? localStatsOpen;
  const setStats = (open: boolean) => {
    if (onStatsOpen) onStatsOpen(open);
    else setLocalStatsOpen(open);
  };
  const threadRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const contextPct =
    usage && usage.contextWindow
      ? Math.min(100, Math.max(0, (usage.context / usage.contextWindow) * 100))
      : 0;
  const remainingContext = usage
    ? Math.max(0, usage.contextWindow - usage.context)
    : CONTEXT_WINDOW;

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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
  }, [onClose, permissionOpen, statsVisible]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;

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
        body: JSON.stringify({ prompt, threadId, model, effort, autoApprove }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        reasoning?: string;
        threadId?: string;
        usage?: Record<string, number>;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Codex 요청에 실패했어요 (${response.status})`);
      }
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
          at: Date.now(),
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Codex에 연결하지 못했어요.');
    } finally {
      window.clearInterval(timerRef.current);
      setBusy(false);
    }
  };

  const reset = () => {
    if (busy) return;
    if (messages.length > 0 && !window.confirm('Codex 대화를 새로 시작할까요?')) return;
    setMessages([]);
    setThreadId('');
    setUsage(null);
    setDraft('');
    setError(null);
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

        <div className="codex-thread" ref={threadRef}>
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

          {messages.map((message) => (
            <article className={`codex-msg ${message.role}`} key={message.id}>
              <span className="codex-msg-label">
                {message.role === 'user' ? 'YOU' : 'CODEX'}
              </span>
              <div className="codex-msg-text">
                <CodexMarkdown text={message.text} />
              </div>
              {message.reasoning && (
                <details className="codex-reasoning">
                  <summary>THINKING</summary>
                  <CodexMarkdown text={message.reasoning} />
                </details>
              )}
            </article>
          ))}

          {busy && (
            <div className="codex-thinking" role="status">
              <Loader2 size={14} className="spin" />
              <span>작업 중...</span>
              <small>{elapsed}s</small>
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
          <div className="inline-panel codex-usage-panel" role="dialog" aria-label="Codex 사용량과 컨텍스트">
            <div className="inline-panel-scroll">
              <div className="sheet-content usage-sheet">
                <div className="sheet-head">
                  <span className="sheet-title">사용량 한도</span>
                  <span className="sheet-sub">{model || 'CLI 기본'}</span>
                  <button
                    type="button"
                    className="sheet-close"
                    onClick={() => setStats(false)}
                    aria-label="사용량 패널 닫기"
                  >
                    <X size={15} />
                  </button>
                </div>
                <section className="quota-section" aria-label="Codex 컨텍스트">
                  <div className="quota-head">
                    <div className="quota-heading">
                      <Gauge size={15} />
                      <div>
                        <div className="quota-title">Codex 계정</div>
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
                    <strong>{model || 'CLI 기본'}</strong>
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
                <button className="wide-btn sheet-anim" onClick={() => setStats(false)}>
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {permissionOpen && !statsVisible && (
          <div className="inline-panel codex-permission-panel" role="dialog" aria-label="Codex 권한 설정">
            <div className="inline-panel-scroll">
              <AutoList
                value={autoApprove}
                onPick={(auto) => {
                  setAutoApprove(auto);
                  setPermissionOpen(false);
                }}
              />
            </div>
          </div>
        )}

        <div className="codex-compose">
          {!statsVisible && !permissionOpen && (
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
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Codex에게 메시지를 입력하세요"
                rows={1}
                disabled={busy}
                aria-label="Codex 메시지 입력"
              />
              <button
                className={`send-btn ${draft.trim() ? 'ready' : ''}`}
                type="submit"
                disabled={!draft.trim() || busy}
                aria-label="Codex에 전송"
              >
                {busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </form>
          )}
          <div className="toolbar codex-toolbar">
            <button
              type="button"
              className={`tb-item ${autoApprove ? 'approved' : ''} ${permissionOpen ? 'is-open' : ''}`}
              onClick={() => {
                setStats(false);
                setPermissionOpen((value) => !value);
              }}
              title={autoApprove ? '명령을 자동 승인합니다' : '명령 승인을 확인합니다'}
              aria-expanded={permissionOpen}
            >
              {autoApprove ? <ShieldCheck size={14} /> : <ShieldQuestion size={14} />}
              <span>{autoApprove ? '자동' : '확인'}</span>
            </button>
            <div className="tb-center codex-toolbar-center">
              <SelectMenu
                className="codex-model-select codex-toolbar-select"
                value={model}
                options={CODEX_MODELS}
                onChange={setModel}
                ariaLabel="Codex 모델 선택"
              />
              <SelectMenu
                className="codex-model-select codex-toolbar-select"
                value={effort}
                options={CODEX_EFFORTS}
                onChange={setEffort}
                ariaLabel="Codex 추론 강도 선택"
              />
            </div>
            <button
              type="button"
              className="tb-item timer"
              onClick={() => {
                setPermissionOpen(false);
                setStats(!statsVisible);
              }}
              aria-label={statsVisible ? 'Codex 사용량 닫기' : 'Codex 사용량과 컨텍스트'}
            >
              <Gauge size={14} />
              <span>
                {usage && usage.contextWindow
                  ? `${Math.round(Math.min(100, (usage.context / usage.contextWindow) * 100))}%`
                  : 'ctx'}
              </span>
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
