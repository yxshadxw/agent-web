import { useEffect, useRef } from 'react';
import { Check, Plus, X } from 'lucide-react';
import anime from 'animejs';
import type { AgentProvider, AgentSession, AgyQuota, Tokens } from '../lib/api';
import { formatTokens, type PinnedFile } from '../data';
import { QuotaSection } from './Quota';

type ModelProps = {
  providers: AgentProvider[];
  providerID: string;
  modelID: string;
  onPick: (providerID: string, modelID: string) => void;
  onAdd?: () => void;
};

export function ModelList({ providers, providerID, modelID, onPick, onAdd }: ModelProps) {
  const rows = providers.flatMap((provider) =>
    Object.values(provider.models).map((model) => ({ provider, model })),
  );

  return (
    <div className="sheet-content model-sheet">
      <div className="sheet-list">
        {rows.map(({ provider, model }) => {
          const selected = provider.id === providerID && model.id === modelID;
          return (
            <button
              key={`${provider.id}/${model.id}`}
              className={`sheet-row model-row ${selected ? 'selected' : ''}`}
              onClick={() => onPick(provider.id, model.id)}
            >
              <span className="model-name">{model.name}</span>
              <span className="row-provider">{model.id}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="sheet-empty">모델을 불러오는 중…</div>}
      </div>
      {onAdd && (
        <button className="sheet-row add-model" onClick={onAdd}>
          <span className="add-plus">
            <Plus size={12} />
          </span>
          <span>모델 추가…</span>
        </button>
      )}
    </div>
  );
}

type ReasonProps = {
  options: string[];
  value: string;
  onPick: (variant: string) => void;
};

const REASON_LABELS: Record<string, string> = {
  minimal: '최소',
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '최대',
};

export function ReasonList({ options, value, onPick }: ReasonProps) {
  return (
    <div className="sheet-content reason-sheet">
      <div className="sheet-list">
        {options.map((level) => (
          <button
            key={level}
            className={`sheet-row reason-row ${value === level ? 'selected' : ''}`}
            onClick={() => onPick(level)}
          >
            <span className="reason-name">{REASON_LABELS[level] || level}</span>
          </button>
        ))}
        {options.length === 0 && (
          <div className="sheet-empty">이 모델은 추론 강도 조절을 지원하지 않아요</div>
        )}
      </div>
    </div>
  );
}

type AutoProps = {
  value: boolean;
  onPick: (auto: boolean) => void;
};

export function AutoList({ value, onPick }: AutoProps) {
  return (
    <div className="sheet-content auto-sheet">
      <button className={`auto-row ${value ? 'selected' : ''}`} onClick={() => onPick(true)}>
        <span className="auto-main">
          <span className="auto-title">자동</span>
          <span className="auto-desc">도구를 묻지 않고 바로 실행합니다.</span>
        </span>
        {value && (
          <span className="auto-check">
            <Check size={14} strokeWidth={2.6} />
          </span>
        )}
      </button>
      <button className={`auto-row ${!value ? 'selected' : ''}`} onClick={() => onPick(false)}>
        <span className="auto-main">
          <span className="auto-title">수동</span>
          <span className="auto-desc">명령 실행과 파일 수정 전에 허락을 구합니다.</span>
        </span>
        {!value && (
          <span className="auto-check">
            <Check size={14} strokeWidth={2.6} />
          </span>
        )}
      </button>
    </div>
  );
}

type ContextProps = {
  used: number;
  limit: number;
  tokens: Tokens;
  modelName: string;
  compressing: boolean;
  onCompress: () => void;
};

export function ContextSheet({
  used,
  limit,
  tokens,
  modelName,
  compressing,
  onCompress,
}: ContextProps) {
  const barRef = useRef<HTMLSpanElement>(null);
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  useEffect(() => {
    if (!barRef.current) return;
    anime({
      targets: barRef.current,
      scaleX: [0, 1],
      duration: 950,
      delay: 160,
      easing: 'easeOutCubic',
    });
  }, []);

  return (
    <div className="sheet-content context-sheet">
      <div className="sheet-head">
        <span className="sheet-title">컨텍스트</span>
        <span className="sheet-sub">{modelName}</span>
      </div>
      <div className="ctx-stats sheet-anim">
        <div className="ctx-pct">{pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</div>
        <div className="ctx-tokens">
          {formatTokens(used)} / {formatTokens(limit)} 토큰
        </div>
        <div className="bar ctx-bar">
          <span className="bar-fill" ref={barRef} style={{ width: `${Math.max(0.5, pct)}%` }} />
        </div>
      </div>
      <div className="ctx-breakdown sheet-anim">
        <div>
          <span>입력</span>
          <strong>{formatTokens(tokens.input + tokens.cache.read + tokens.cache.write)}</strong>
        </div>
        <div>
          <span>출력</span>
          <strong>{formatTokens(tokens.output)}</strong>
        </div>
        <div>
          <span>추론</span>
          <strong>{formatTokens(tokens.reasoning)}</strong>
        </div>
        <div>
          <span>캐시</span>
          <strong>{formatTokens(tokens.cache.read)}</strong>
        </div>
      </div>
      <button className="wide-btn sheet-anim" onClick={onCompress} disabled={compressing}>
        {compressing ? '압축하는 중…' : '컨텍스트 압축'}
      </button>
    </div>
  );
}

type UsageProps = {
  session: AgentSession | null;
  tokens: Tokens;
  cost: number;
  messageCount: number;
  modelName: string;
  pinned: PinnedFile[];
  quota: AgyQuota | null;
  quotaLoading: boolean;
  onRefreshQuota: () => void;
  onClose: () => void;
  onOpenInfo: () => void;
};

export function UsageSheet({
  session,
  tokens,
  cost,
  messageCount,
  modelName,
  pinned,
  quota,
  quotaLoading,
  onRefreshQuota,
  onClose,
  onOpenInfo,
}: UsageProps) {
  const created = session?.time.created ? new Date(session.time.created) : null;
  return (
    <div className="sheet-content usage-sheet">
      <div className="sheet-head">
        <span className="sheet-title">사용량 한도</span>
        <span className="sheet-sub">{session?.title || '새 세션'}</span>
        <button
          type="button"
          className="sheet-close"
          onClick={onClose}
          aria-label="사용량 한도 닫기"
        >
          <X size={15} />
        </button>
      </div>
      <QuotaSection
        quota={quota}
        loading={quotaLoading}
        onRefresh={onRefreshQuota}
      />
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
          <div className="usage-big">{formatTokens(tokens.input + tokens.cache.read + tokens.cache.write)}</div>
          <div className="usage-sub">캐시 {formatTokens(tokens.cache.read)} 포함</div>
        </div>
        <div className="usage-cell sheet-anim">
          <div className="usage-title">
            <span className="status-dot amber" />
            출력
          </div>
          <div className="usage-big">{formatTokens(tokens.output)}</div>
          <div className="usage-sub">추론 {formatTokens(tokens.reasoning)}</div>
        </div>
      </div>
      <div className="usage-list sheet-anim">
        <div>
          <span>모델</span>
          <strong>{modelName}</strong>
        </div>
        <div>
          <span>비용</span>
          <strong>{cost > 0 ? `$${cost.toFixed(4)}` : '무료'}</strong>
        </div>
        <div>
          <span>메시지</span>
          <strong>{messageCount}개</strong>
        </div>
        <div>
          <span>시작</span>
          <strong>
            {created
              ? created.toLocaleString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </strong>
        </div>
        <div>
          <span>핀</span>
          <strong>{pinned.length}개</strong>
        </div>
      </div>
      <button className="wide-btn sheet-anim" onClick={onOpenInfo}>
        정보 탭에서 보기
      </button>
    </div>
  );
}
