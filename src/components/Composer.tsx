import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Todo } from '@opencode-ai/sdk';
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  Square,
  X,
} from 'lucide-react';
import { fmtClock, type ComposerPanel } from '../data';
import { TodoBar } from './TodoBar';

export type Attachment = {
  mime: string;
  filename: string;
  url: string;
  size: number;
};

type Props = {
  draft: string;
  setDraft: (value: string) => void;
  onSend: (text: string, files: Attachment[]) => void;
  onAbort: () => void;
  busy: boolean;
  disabled: boolean;
  model: string;
  variant: string;
  hasVariants: boolean;
  elapsed: number;
  todos: Todo[];
  todoStorageKey?: string;
  autoApprove: boolean;
  panel: ComposerPanel;
  onPanel: (panel: ComposerPanel) => void;
  panelContent: ReactNode;
  onToast: (message: string) => void;
  showContextRing: boolean;
  remainingPct: number;
  remainingLabel?: string | null;
};

const MAX_FILES = 4;
const MAX_FILE_BYTES = 6 * 1024 * 1024;

export function Composer({
  draft,
  setDraft,
  onSend,
  onAbort,
  busy,
  disabled,
  model,
  variant,
  hasVariants,
  elapsed,
  todos,
  todoStorageKey,
  autoApprove,
  panel,
  onPanel,
  panelContent,
  onToast,
  showContextRing,
  remainingPct,
  remainingLabel,
}: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const lastPanelRef = useRef<{ panel: ComposerPanel; content: ReactNode } | null>(null);
  const panelCloseTimer = useRef<number | undefined>(undefined);
  const [, forcePanelCleanup] = useState(0);

  if (panel) {
    lastPanelRef.current = { panel, content: panelContent };
  }
  const visiblePanel = panel ?? lastPanelRef.current?.panel ?? null;
  const visiblePanelContent = panel ? panelContent : lastPanelRef.current?.content ?? null;

  useEffect(() => {
    if (panel) {
      window.clearTimeout(panelCloseTimer.current);
      return;
    }
    if (!lastPanelRef.current) return;
    panelCloseTimer.current = window.setTimeout(() => {
      lastPanelRef.current = null;
      forcePanelCleanup((value) => value + 1);
    }, 240);
    return () => window.clearTimeout(panelCloseTimer.current);
  }, [panel]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft, panel]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPanel(null);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (toolbarRef.current?.contains(target)) return;
      onPanel(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [panel, onPanel]);

      {!panel && (
        <TodoBar todos={todos} onToast={onToast} storageKey={todoStorageKey} />
      )}

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files);
    const next: Attachment[] = [];
    for (const file of incoming) {
      if (attachments.length + next.length >= MAX_FILES) {
        onToast(`첨부는 최대 ${MAX_FILES}개까지 가능해요`);
        break;
      }
      if (!file.type.startsWith('image/')) {
        onToast('이미지 파일만 첨부할 수 있어요');
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        onToast('6MB 이하 이미지만 첨부할 수 있어요');
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || '');
        if (!url) return;
        setAttachments((current) =>
          current.length >= MAX_FILES
            ? current
            : [...current, { mime: file.type, filename: file.name, url, size: file.size }],
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const panelLabel =
    visiblePanel === 'auto'
      ? '권한 설정'
      : visiblePanel === 'model'
      ? '모델 변경'
      : visiblePanel === 'reason'
        ? '추론 강도'
        : visiblePanel === 'context'
          ? '컨텍스트'
          : visiblePanel === 'usage'
            ? '사용량 한도'
            : '패널';

  const submit = () => {
    if (busy) {
      onToast('현재 작업이 끝난 뒤 보낼 수 있어요');
      return;
    }
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    onSend(text, attachments);
    setDraft('');
    setAttachments([]);
    if (textarea.current) textarea.current.style.height = 'auto';
  };

  return (
    <div
      className={`dock ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {!panel && (
        <TodoBar todos={todos} onToast={onToast} storageKey={todoStorageKey} />
      )}

      {!panel && attachments.length > 0 && (
        <div className="attach-tray">
          {attachments.map((file, index) => (
            <div className="attach-chip" key={`${file.filename}-${index}`}>
              <img src={file.url} alt={file.filename} />
              <button
                onClick={() =>
                  setAttachments((current) => current.filter((_, i) => i !== index))
                }
                aria-label="첨부 삭제"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {visiblePanel ? (
        <div
          className={`inline-panel ${!panel ? 'is-collapsing' : ''}`}
          ref={panelRef}
          role="region"
          aria-label={panelLabel}
          aria-hidden={!panel || undefined}
        >
          <div className="inline-panel-scroll">{visiblePanelContent}</div>
        </div>
      ) : (
        <form
          className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          className="plus-btn"
          onClick={() => fileInput.current?.click()}
          aria-label="이미지 첨부"
        >
          <Plus size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <textarea
          ref={textarea}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={disabled ? '접속을 기다리는 중…' : '메시지를 입력하세요'}
          aria-label="메시지 입력"
          disabled={disabled}
        />
        <button
          type={busy ? 'button' : 'submit'}
          className={`send-btn ${busy ? 'stopping' : draft.trim() || attachments.length ? 'ready' : ''}`}
          onClick={busy ? onAbort : undefined}
          aria-label={busy ? '작업 중단' : '전송'}
          disabled={!busy && (disabled || (!draft.trim() && attachments.length === 0))}
        >
          {busy ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
        </button>
        </form>
      )}

      <div className="toolbar" ref={toolbarRef}>
        <button
          className={`tb-item ${autoApprove ? 'approved' : ''} ${panel === 'auto' ? 'is-open' : ''}`}
          onClick={() => onPanel(panel === 'auto' ? null : 'auto')}
          title={autoApprove ? '권한 요청을 자동으로 허용해요' : '권한 요청을 직접 확인해요'}
          aria-expanded={panel === 'auto'}
        >
          {autoApprove ? <ShieldCheck size={14} /> : <ShieldQuestion size={14} />}
          <span>{autoApprove ? '자동' : '확인'}</span>
          <ChevronDown size={12} className={`tb-chev ${panel === 'auto' ? 'flip' : ''}`} />
        </button>

        <div className="tb-center">
          <button
            className={`tb-item model ${panel === 'model' ? 'is-open' : ''}`}
            onClick={() => onPanel(panel === 'model' ? null : 'model')}
            aria-expanded={panel === 'model'}
          >
            <span>{model}</span>
            <ChevronDown size={12} className={`tb-chev ${panel === 'model' ? 'flip' : ''}`} />
          </button>
          {hasVariants && (
            <button
              className={`tb-item ${panel === 'reason' ? 'is-open' : ''}`}
              onClick={() => onPanel(panel === 'reason' ? null : 'reason')}
              aria-expanded={panel === 'reason'}
            >
              <span>{variant || '기본'}</span>
              <ChevronDown size={12} className={`tb-chev ${panel === 'reason' ? 'flip' : ''}`} />
            </button>
          )}
        </div>

        <button
          className={`tb-item timer ${busy ? 'busy' : 'idle'} ${panel === 'usage' ? 'is-open' : ''}`}
          onClick={() => onPanel(panel === 'usage' ? null : 'usage')}
          aria-label="사용량 한도"
          aria-expanded={panel === 'usage'}
        >
          {showContextRing && (
            <span
              className="timer-ring"
              title={
                remainingLabel
                  ? `남은 시간 ${remainingLabel}`
                  : `남은 사용량 ${Math.round(remainingPct)}%`
              }
              style={{
                background: `conic-gradient(#f2763a 0 ${Math.max(0, Math.min(100, remainingPct))}%, #35251e ${Math.max(0, Math.min(100, remainingPct))}% 360deg)`,
              }}
            />
          )}
          <span>{remainingLabel || fmtClock(elapsed)}</span>
        </button>
      </div>
    </div>
  );
}
