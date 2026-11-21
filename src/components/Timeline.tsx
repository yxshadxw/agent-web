import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type {
  FilePart,
  Part,
  Permission,
  ReasoningPart,
  TextPart,
  ToolPart,
} from '@opencode-ai/sdk';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  ShieldAlert,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import type { AssistantMessageInfo, MessageWithParts, PermissionRequest } from '../lib/api';
import { engineLabel, getEngine } from '../lib/engine';
import { fmtDuration, formatTokens, timeLabel, type PinnedFile } from '../data';
import { BrandGlyph } from './Brand';
import { ToolDiff, hasDiffSignal } from './ToolDiff';

marked.setOptions({ gfm: true, breaks: true });

type Props = {
  messages: MessageWithParts[];
  busy: boolean;
  error: string | null;
  onClearError: () => void;
  onToast: (msg: string) => void;
  onSuggestion: (text: string) => void;
  onRetry: () => void;
  onFork: (messageID: string) => void;
  permissions: PermissionRequest[];
  onPermission: (permission: PermissionRequest, response: 'once' | 'always' | 'reject') => void;
  onPin: (file: PinnedFile) => void;
  pinned: PinnedFile[];
  expandThinking: boolean;
  canFork: boolean;
};

export function Timeline({
  messages,
  busy,
  error,
  onClearError,
  onToast,
  onSuggestion,
  onRetry,
  onFork,
  permissions,
  onPermission,
  onPin,
  pinned,
  expandThinking,
  canFork,
}: Props) {
  const lastAssistant = [...messages].reverse().find((message) => message.info.role === 'assistant');
  const hasVisibleOutput =
    !!lastAssistant &&
    lastAssistant.parts.some(
      (part) =>
        (part.type === 'text' && !part.synthetic && !part.ignored && part.text.trim()) ||
        part.type === 'tool' ||
        part.type === 'reasoning',
    );

  if (messages.length === 0 && !busy) {
    return (
      <div className="timeline">
        <div className="empty-state">
          <div className="empty-mark">
            <BrandGlyph />
          </div>
          <h2>무엇을 도와드릴까요?</h2>
          <p>
            메시지를 보내면 실제 {engineLabel(getEngine())} 에이전트가 코드를 읽고,
            실행하고, 파일을 수정합니다.
          </p>
          <div className="empty-suggestions">
            {[
              '이 프로젝트 구조를 파악해서 요약해줘',
              '테스트를 실행하고 실패한 부분을 고쳐줘',
              '최근 변경사항을 리뷰하고 개선점을 알려줘',
            ].map((text) => (
              <button key={text} className="empty-suggestion" onClick={() => onSuggestion(text)}>
                <span>{text}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          <div className="empty-hint">
            <Terminal size={13} />
            Enter로 전송 · Shift+Enter로 줄바꿈
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline">
      {messages.map((message) =>
        message.info.role === 'user' ? (
          <UserMessage key={message.info.id} message={message} onToast={onToast} />
        ) : (
          <AssistantMessage
            key={message.info.id}
            message={message}
            busy={busy && lastAssistant?.info.id === message.info.id}
            onToast={onToast}
            onRetry={onRetry}
            onFork={onFork}
            onPin={onPin}
            pinned={pinned}
            expandThinking={expandThinking}
            canFork={canFork}
          />
        ),
      )}

      {busy && !hasVisibleOutput && (
        <div className="bubble-row agent bubble-in">
          <span className="agent-dot" />
          <div className="bubble agent typing">
            <Loader2 size={14} className="spin" />
            <span>생각하는 중…</span>
          </div>
        </div>
      )}

      {permissions.map((permission) => (
        <PermissionCard
          key={permission.id}
          permission={permission}
          onRespond={(response) => onPermission(permission, response)}
        />
      ))}

      {error && (
        <div className="session-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button onClick={onClearError} aria-label="오류 닫기">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function UserMessage({
  message,
  onToast,
}: {
  message: MessageWithParts;
  onToast: (msg: string) => void;
}) {
  const texts = message.parts.filter(
    (part): part is TextPart => part.type === 'text' && !part.synthetic && !part.ignored,
  );
  const files = message.parts.filter((part): part is FilePart => part.type === 'file');
  const text = texts.map((part) => part.text).join('\n\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('메시지를 복사했어요');
    } catch {
      onToast('복사할 수 없어요');
    }
  };

  return (
    <div className="turn user-turn msg-anim">
      <div className="bubble-row user">
        <div className="bubble user">
          {files.length > 0 && (
            <div className={`user-files ${text ? 'with-text' : ''}`}>
              {files.map((file) => (
                <UserFile key={file.id} file={file} />
              ))}
            </div>
          )}
          {text && <div className="user-text">{text}</div>}
        </div>
      </div>
      <div className="msg-meta user-meta">
        <button className="meta-btn" onClick={copy} aria-label="복사">
          <Copy size={13} />
        </button>
        <span className="meta-time">{timeLabel(message.info.time.created)}</span>
      </div>
    </div>
  );
}

function UserFile({ file }: { file: FilePart }) {
  const isImage = file.mime.startsWith('image/') && file.url.startsWith('data:');
  if (isImage) {
    return (
      <a className="user-image" href={file.url} target="_blank" rel="noreferrer">
        <img src={file.url} alt={file.filename || '첨부 이미지'} />
      </a>
    );
  }
  return (
    <span className="user-file">
      {file.mime.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
      <span>{file.filename || '첨부 파일'}</span>
    </span>
  );
}

function AssistantMessage({
  message,
  busy,
  onToast,
  onRetry,
  onFork,
  onPin,
  pinned,
  expandThinking,
  canFork,
}: {
  message: MessageWithParts;
  busy: boolean;
  onToast: (msg: string) => void;
  onRetry: () => void;
  onFork: (messageID: string) => void;
  onPin: (file: PinnedFile) => void;
  pinned: PinnedFile[];
  expandThinking: boolean;
  canFork: boolean;
}) {
  const info = message.info as AssistantMessageInfo;
  const reasoning = message.parts.filter(
    (part): part is ReasoningPart => part.type === 'reasoning' && part.text.trim().length > 0,
  );
  const textParts = message.parts.filter(
    (part): part is TextPart => part.type === 'text' && !part.synthetic && !part.ignored,
  );
  const tools = (() => {
    const unique = new Map<string, ToolPart>();
    for (const part of message.parts) {
      if (part.type === 'tool') unique.set(part.callID, part);
    }
    return [...unique.values()];
  })();
  const subtasks = message.parts.filter((part) => part.type === 'subtask');
  const text = textParts.map((part) => part.text).join('\n\n');
  const modelName = info.modelID;
  const duration = info.time.completed
    ? (info.time.completed - info.time.created) / 1000
    : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || tools.map((tool) => tool.state.input && JSON.stringify(tool.state.input, null, 2)).join('\n'));
      onToast('응답을 복사했어요');
    } catch {
      onToast('복사할 수 없어요');
    }
  };

  return (
    <div className="turn agent-turn msg-anim">
      {reasoning.length > 0 && (
        <ReasoningBlock parts={reasoning} busy={busy} defaultOpen={expandThinking} />
      )}

      {tools.length > 0 && (
        <div className="tools">
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              onPin={onPin}
              pinned={pinned}
            />
          ))}
        </div>
      )}

      {subtasks.map((part) =>
        part.type === 'subtask' ? (
          <div className="subtask-row" key={part.id}>
            <Bot size={14} />
            <span>{part.description || part.agent}</span>
          </div>
        ) : null,
      )}

      {info.error && <ErrorCard error={info.error} />}

      {textParts.map((part, index) => (
        <MarkdownText
          key={part.id}
          text={part.text}
          streaming={busy && index === textParts.length - 1}
        />
      ))}

      {text && (
        <div className="msg-meta">
          <div className="meta-actions">
            <button className="meta-btn" onClick={copy} aria-label="복사">
              <Copy size={14} />
            </button>
            <button className="meta-btn" onClick={onRetry} aria-label="다시 시도">
              <RotateCcw size={14} />
            </button>
            {canFork && (
              <button
                className="meta-btn"
                onClick={() => onFork(message.info.id)}
                aria-label="여기서 분기"
              >
                <GitBranch size={14} />
              </button>
            )}
          </div>
          <span className="meta-time">
            {busy ? (
              <span className="meta-live">
                <i /> 작업 중
              </span>
            ) : (
              <>
                {modelName}
                {duration ? ` · ${fmtDuration(duration)}` : ''} ·{' '}
                {timeLabel(info.time.completed || info.time.created)}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({
  parts,
  busy,
  defaultOpen,
}: {
  parts: ReasoningPart[];
  busy: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  const start = Math.min(...parts.map((part) => part.time.start));
  const openPart = parts.find((part) => !part.time.end);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!openPart && !busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [openPart, busy]);

  const end = openPart ? now : Math.max(...parts.map((part) => part.time.end || part.time.start));
  const seconds = Math.max(0, (end - start) / 1000);

  return (
    <div className="thinking msg-anim">
      <button
        className="thinking-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={15} className="chev open" />
        ) : (
          <ChevronRight size={15} className="chev" />
        )}
        <span>생각 {fmtDuration(seconds)}</span>
        {busy && <span className="thinking-live" />}
      </button>
      {open && (
        <div className="thinking-body reasoning-body">
          {parts.map((part) => (
            <p key={part.id}>{part.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkdownText({ text, streaming }: { text: string; streaming: boolean }) {
  const html = useMemo(() => {
    const rendered = marked.parse(text) as string;
    return DOMPurify.sanitize(rendered, {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'form', 'input'],
    });
  }, [text]);

  return (
    <div className="assistant-text">
      <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
}

function ErrorCard({ error }: { error: NonNullable<AssistantMessageInfo['error']> }) {
  const message =
    (error as { data?: { message?: string } }).data?.message ||
    error.name ||
    '응답을 생성하지 못했어요';
  return (
    <div className="limit-error msg-anim">
      <AlertTriangle size={15} />
      <span>{message}</span>
    </div>
  );
}

function toolMeta(tool: ToolPart) {
  const state = tool.state;
  const input = (state.input || {}) as Record<string, unknown>;
  const keys = [
    'command',
    'description',
    'filePath',
    'path',
    'pattern',
    'query',
    'url',
    'prompt',
  ];
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.replace(/\s+/g, ' ').slice(0, 120);
    }
  }
  if (typeof input.todos !== 'undefined') return 'todo 목록 갱신';
  if (state.status === 'completed' && state.title) return state.title;
  if (state.status === 'error') return state.error;
  if (state.status === 'running' && state.title) return state.title;
  return tool.tool;
}

function toolKind(name: string) {
  if (name.startsWith('mcp') || name.includes('__')) return 'mcp';
  if (name === 'bash' || name === 'shell') return 'bash';
  if (name === 'read' || name === 'glob' || name === 'grep' || name === 'list') return 'read';
  if (name === 'edit' || name === 'write' || name === 'patch' || name === 'multiedit') return 'write';
  if (name === 'todowrite' || name === 'todoread') return 'todo';
  if (name === 'task') return 'agent';
  if (name === 'webfetch' || name === 'websearch') return 'web';
  return 'tool';
}

function ToolIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'bash':
      return <Terminal size={14} />;
    case 'read':
      return <Search size={14} />;
    case 'write':
      return <Pencil size={14} />;
    case 'todo':
      return <Check size={14} />;
    case 'agent':
      return <Bot size={14} />;
    case 'web':
      return <Globe size={14} />;
    default:
      return <Wrench size={14} />;
  }
}

function ToolRow({
  tool,
  onPin,
  pinned,
}: {
  tool: ToolPart;
  onPin: (file: PinnedFile) => void;
  pinned: PinnedFile[];
}) {
  const [open, setOpen] = useState(false);
  const state = tool.state;
  const kind = toolKind(tool.tool);
  const hint = toolMeta(tool);
  const running = state.status === 'running' || state.status === 'pending';
  const failed = state.status === 'error';
  const filePath =
    typeof state.input.filePath === 'string'
      ? state.input.filePath
      : typeof state.input.path === 'string'
        ? state.input.path
        : null;
  const isPinned = filePath ? pinned.some((pin) => pin.path === filePath) : false;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const start = 'time' in state ? state.time.start : undefined;
  const elapsed = start ? ((state.status === 'completed' || state.status === 'error' ? state.time.end : now) - start) / 1000 : 0;

  const output =
    state.status === 'completed'
      ? state.output
      : state.status === 'error'
        ? state.error
        : '';
  const inputText = JSON.stringify(state.input ?? {}, null, 2);
  const outputLimited =
    output.length > 8000 ? `${output.slice(0, 8000)}\n\n… ${output.length - 8000}자 더 있음` : output;

  return (
    <div className={`tool real ${open ? 'open' : ''} ${failed ? 'failed' : ''}`}>
      <div
        className="tool-main"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        aria-expanded={open}
      >
        <span className={`tool-status ${running ? 'running' : failed ? 'error' : 'done'}`}>
          {running ? (
            <Loader2 size={13} className="spin" />
          ) : failed ? (
            <X size={13} />
          ) : (
            <Check size={13} strokeWidth={3} />
          )}
        </span>
        <span className={`tool-ico kind-${kind}`}>
          <ToolIcon kind={kind} />
        </span>
        <span className="tool-kind">{kind}</span>
        <span className="tool-name">{hint}</span>
        {elapsed > 0 && <span className="tool-time">{fmtDuration(elapsed)}</span>}
        {filePath && (
          <button
            className={`tool-pin ${isPinned ? 'active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onPin({ path: filePath, at: Date.now() });
            }}
            aria-label="파일 핀"
          >
            <FileCode2 size={13} />
          </button>
        )}
        <ChevronDown size={14} className={`tool-chev ${open ? 'open' : ''}`} />
      </div>
      {open && (
        <div className="tool-detail">
          {kind === 'write' && (() => {
            const inp = (state.input || {}) as Record<string, unknown>;
            const oldStr = typeof inp.oldString === 'string' ? inp.oldString : typeof inp.old_string === 'string' ? inp.old_string : undefined;
            const newStr = typeof inp.newString === 'string' ? inp.newString : typeof inp.new_string === 'string' ? inp.new_string : undefined;
            const raw = hasDiffSignal(outputLimited) ? outputLimited : typeof inp.patch === 'string' ? inp.patch : undefined;
            return (
              <ToolDiff
                oldText={oldStr}
                newText={newStr}
                rawDiff={raw}
                fileName={filePath || undefined}
              />
            );
          })()}
          <div className="tool-detail-label">입력</div>
          <pre className="tool-args">{inputText}</pre>
          {output && (
            <>
              <div className="tool-detail-label">출력</div>
              <pre className="tool-args tool-output">{outputLimited}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  permission,
  onRespond,
}: {
  permission: Permission;
  onRespond: (response: 'once' | 'always' | 'reject') => void;
}) {
  const metadata = permission.metadata || {};
  const detail =
    typeof metadata.command === 'string'
      ? metadata.command
      : typeof metadata.description === 'string'
        ? metadata.description
        : typeof metadata.path === 'string'
          ? metadata.path
          : null;

  return (
    <div className="permission-card msg-anim">
      <div className="permission-head">
        <ShieldAlert size={17} />
        <div>
          <div className="permission-title">승인이 필요해요</div>
          <div className="permission-sub">{permission.title}</div>
        </div>
      </div>
      {detail && <pre className="permission-detail">{detail}</pre>}
      <div className="permission-actions">
        <button className="permission-btn danger" onClick={() => onRespond('reject')}>
          거부
        </button>
        <button className="permission-btn" onClick={() => onRespond('always')}>
          항상 허용
        </button>
        <button className="permission-btn primary" onClick={() => onRespond('once')}>
          허용
        </button>
      </div>
    </div>
  );
}
