import { RefreshCw, Sparkles } from 'lucide-react';
import type { AgyQuota, AgyQuotaBucket } from '../lib/api';

type Props = {
  quota: AgyQuota | null;
  loading: boolean;
  onRefresh: () => void;
};

function groupLabel(name: string) {
  if (/^Gemini Models$/i.test(name)) return 'Gemini';
  if (/^Claude and GPT models$/i.test(name)) return 'Claude · GPT';
  return name;
}

function windowLabel(bucket: AgyQuotaBucket) {
  if (bucket.window === '5h') return '5시간';
  if (bucket.window === 'weekly') return '주간';
  return bucket.name.replace(/\s*Limit.*$/i, '') || '한도';
}

function remainingLabel(bucket: AgyQuotaBucket) {
  if (bucket.disabled) return '미적용';
  if (bucket.remaining === null) return '측정 없음';
  if (bucket.remaining <= 0) return '한도 소진';
  return `${bucket.remaining}% 남음`;
}

function resetLabel(bucket: AgyQuotaBucket) {
  if (!bucket.resetAt) return null;
  const reset = new Date(bucket.resetAt);
  if (Number.isNaN(reset.getTime())) return null;

  if (bucket.window === '5h') {
    const minutes = Math.max(0, Math.round((reset.getTime() - Date.now()) / 60_000));
    if (minutes < 1) return '곧 초기화';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? `${hours}시간 ${rest}분 뒤 초기화` : `${rest}분 뒤 초기화`;
  }

  return `${reset.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} 초기화`;
}

function disabledLabel(bucket: AgyQuotaBucket) {
  if (bucket.window === '5h') {
    return '주간 한도가 소진되어 5시간 한도가 적용되지 않아요.';
  }
  return '현재 적용되지 않는 한도예요.';
}

export function QuotaSection({ quota, loading, onRefresh }: Props) {
  if (!quota && !loading) return null;

  const groups = quota?.groups ?? [];
  const hasClaude = groups.some(
    (group) =>
      /claude/i.test(group.name) ||
      group.models.some((model) => /claude/i.test(model)),
  );

  return (
    <section className="quota-section" aria-label="구독 한도">
      <div className="quota-head">
        <div className="quota-heading">
          <Sparkles size={15} />
          <div>
            <div className="quota-title">구독 한도</div>
            <div className="quota-caption">
              Agy 계정{hasClaude ? ' · Claude 포함' : ''}
            </div>
          </div>
        </div>
        <button
          className="quota-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="사용량 한도 새로 고침"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !quota && (
        <div className="quota-loading" role="status">
          <RefreshCw size={14} className="spin" />
          Agy 한도를 불러오는 중…
        </div>
      )}

      {quota?.stale && (
        <div className="quota-stale" role="status">
          마지막으로 불러온 한도예요{quota.error ? ' · 새로고침에 실패했어요' : ''}
        </div>
      )}

      {quota?.error && groups.length === 0 && (
        <div className="quota-error" role="alert">
          <span>{quota.error}</span>
          <button onClick={onRefresh} disabled={loading}>
            다시 시도
          </button>
        </div>
      )}

      {groups.map((group) => (
        <article className="quota-card" key={group.name}>
          <div className="quota-group-head">
            <span className="quota-group-name" title={group.name}>
              {groupLabel(group.name)}
            </span>
            {group.models.length > 0 && (
              <span className="quota-group-meta">
                {`${group.models.slice(0, 3).join(' · ')}${
                  group.models.length > 3 ? ` 외 ${group.models.length - 3}` : ''
                }`}
              </span>
            )}
          </div>

          {group.buckets.map((bucket) => {
            const critical =
              !bucket.disabled && bucket.remaining !== null && bucket.remaining <= 10;
            return (
              <div
                className={`quota-window ${bucket.disabled ? 'disabled' : ''} ${
                  critical ? 'critical' : ''
                }`}
                key={`${group.name}-${bucket.id}-${bucket.window}`}
              >
                <div className="quota-line">
                  <span>{windowLabel(bucket)}</span>
                  <strong>{remainingLabel(bucket)}</strong>
                </div>
                {!bucket.disabled && (
                  <div
                    className="bar quota-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={bucket.remaining ?? 0}
                    aria-label={`${groupLabel(group.name)} ${windowLabel(bucket)} ${remainingLabel(bucket)}`}
                  >
                    <span
                      className="bar-fill"
                      style={{ width: `${bucket.remaining ?? 0}%` }}
                    />
                  </div>
                )}
                <div className="quota-reset">
                  {bucket.disabled
                    ? disabledLabel(bucket)
                    : resetLabel(bucket) || '초기화 시간이 제공되지 않았어요.'}
                </div>
              </div>
            );
          })}

          {group.buckets.length === 0 && (
            <div className="quota-empty">이 그룹은 표시할 한도가 없어요.</div>
          )}
        </article>
      ))}

      {quota && groups.length === 0 && !quota.error && !loading && (
        <div className="quota-empty">Agy가 표시할 한도를 반환하지 않았어요.</div>
      )}

      <div className="quota-foot">Agy CLI /usage의 실제 5시간·주간 한도</div>
    </section>
  );
}
