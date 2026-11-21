import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Cpu, RefreshCw, Sparkles } from 'lucide-react';
import type { AgyQuota, AgyQuotaBucket } from '../lib/api';

export type CodexQuotaSnapshot = {
  plan?: string | null;
  email?: string | null;
  primary?: { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null } | null;
  secondary?: { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null } | null;
};

type Props = {
  quota: AgyQuota | null;
  loading: boolean;
  onRefresh: () => void;
  codexQuota?: CodexQuotaSnapshot | null;
  activeEngine?: string;
};

type SubSection = {
  title?: string;
  buckets: AgyQuotaBucket[];
};

type UnifiedCard = {
  id: string;
  provider: string;
  plan: string;
  account?: string | null;
  active?: boolean;
  kind: 'agy' | 'codex';
  sections: SubSection[];
};

function groupLabel(name: string) {
  if (/^Gemini Models$/i.test(name)) return { provider: 'Gemini', plan: 'Google' };
  if (/^Claude and GPT models$/i.test(name)) return { provider: 'Agy · Claude', plan: '' };
  return { provider: name, plan: '' };
}

function windowLabel(bucket: AgyQuotaBucket, prefix?: string) {
  const base =
    bucket.window === '5h'
      ? '5시간'
      : bucket.window === 'weekly'
        ? '주간'
        : bucket.name.replace(/\s*Limit.*$/i, '') || '한도';
  return prefix ? `${prefix} · ${base}` : base;
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

function codexBuckets(codex: CodexQuotaSnapshot | null | undefined): AgyQuotaBucket[] {
  if (!codex) return [];
  const entries = [codex.primary, codex.secondary].filter(
    (w): w is NonNullable<CodexQuotaSnapshot['primary']> => Boolean(w),
  );
  return entries.map((win, index) => {
    const isWeekly = (win.windowDurationMins ?? 0) >= 24 * 60;
    return {
      id: isWeekly ? 'codex-weekly' : `codex-5h-${index}`,
      window: isWeekly ? 'weekly' : '5h',
      name: isWeekly ? '주간 한도' : '5시간 한도',
      remaining: Math.max(0, Math.min(100, Math.round(100 - win.usedPercent))),
      resetAt: win.resetsAt ? new Date(win.resetsAt * 1000).toISOString() : null,
      disabled: false,
    };
  });
}

function minRemaining(sections: SubSection[]) {
  const vals = sections
    .flatMap((s) => s.buckets)
    .filter((b) => !b.disabled && typeof b.remaining === 'number')
    .map((b) => b.remaining as number);
  if (!vals.length) return null;
  return Math.max(0, Math.min(100, Math.min(...vals)));
}

export function QuotaSection({
  quota,
  loading,
  onRefresh,
  codexQuota: externalCodexQuota,
  activeEngine,
}: Props) {
  const [fetchedCodex, setFetchedCodex] = useState<CodexQuotaSnapshot | null>(null);
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (externalCodexQuota !== undefined) return;
    let alive = true;
    void fetch('/codex-api/quota', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && (data.primary || data.secondary || data.plan)) {
          setFetchedCodex(data as CodexQuotaSnapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [externalCodexQuota]);

  const codex = externalCodexQuota ?? fetchedCodex;
  const groups = quota?.groups ?? [];
  const cards: UnifiedCard[] = [];
  const isCodexActive = activeEngine === 'codex';
  const isAgyActive = activeEngine === 'agy' || activeEngine === 'antigravity';

  const argonGroups = groups.filter((g) => /argon/i.test(g.name));
  const primaryGroups = groups.filter((g) => !/argon/i.test(g.name));

  for (const group of primaryGroups) {
    const { provider, plan } = groupLabel(group.name);
    const isGemini = /^Gemini$/i.test(provider);
    const mergedBuckets: (AgyQuotaBucket & { prefix?: string })[] = [...group.buckets];
    if (isGemini) {
      for (const ag of argonGroups) {
        const prefix = ag.name.replace(/^Gemini\s*4\s*/i, '').trim() || 'Argon';
        for (const b of ag.buckets) {
          mergedBuckets.push({ ...b, prefix });
        }
      }
    }
    cards.push({
      id: `agy:${group.name}`,
      provider,
      plan,
      active: isAgyActive && isGemini,
      kind: 'agy',
      sections: [{ buckets: mergedBuckets }],
    });
  }

  // If only Argon came back without a parent Gemini group, render it under Gemini.
  if (primaryGroups.every((g) => !/gemini/i.test(g.name)) && argonGroups.length > 0) {
    cards.unshift({
      id: 'agy:gemini-argon',
      provider: 'Gemini',
      plan: 'Google',
      active: isAgyActive,
      kind: 'agy',
      sections: argonGroups.map((ag) => ({ title: ag.name, buckets: ag.buckets })),
    });
  }

  const cxBuckets = codexBuckets(codex);
  if (cxBuckets.length > 0 || codex?.plan) {
    const rawPlan = (codex?.plan || 'Plus').replace(/^plus$/i, 'Plus').replace(/^pro$/i, 'Pro');
    cards.push({
      id: 'codex:account',
      provider: 'ChatGPT',
      plan: rawPlan,
      account: codex?.email || null,
      active: isCodexActive,
      kind: 'codex',
      sections: [{ buckets: cxBuckets }],
    });
  }

  const activeCardId = cards.find((c) => c.active)?.id || cards[0]?.id || null;
  const resolvedOpenId = openId === undefined ? activeCardId : openId;
  const isCardOpen = (card: UnifiedCard) => resolvedOpenId === card.id;

  if (cards.length === 0 && !loading && !quota?.error) return null;

  return (
    <section className="quota-section" aria-label="구독 한도">
      <div className="quota-head">
        <div className="quota-heading">
          <Sparkles size={15} />
          <div>
            <div className="quota-title">구독 한도</div>
            <div className="quota-caption">연결된 계정의 실제 5시간·주간 한도</div>
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

      {loading && cards.length === 0 && (
        <div className="quota-loading" role="status">
          <RefreshCw size={14} className="spin" />
          구독 한도를 불러오는 중…
        </div>
      )}

      {quota?.stale && (
        <div className="quota-stale" role="status">
          마지막으로 불러온 한도예요{quota.error ? ' · 새로고침에 실패했어요' : ''}
        </div>
      )}

      {quota?.error && cards.length === 0 && (
        <div className="quota-error" role="alert">
          <span>{quota.error}</span>
          <button onClick={onRefresh} disabled={loading}>
            다시 시도
          </button>
        </div>
      )}

      {cards.map((card) => {
        const open = isCardOpen(card);
        const pct = minRemaining(card.sections);
        if (!open) {
          return (
            <button
              type="button"
              key={card.id}
              className="sub-row"
              onClick={() => setOpenId(card.id)}
              aria-expanded={false}
            >
              <ChevronRight size={15} className="sub-chev" />
              {card.kind === 'codex' ? <Cpu size={15} /> : <Sparkles size={15} />}
              <span className="sub-name">{card.provider}</span>
              {card.plan && <span className="sub-plan">{card.plan}</span>}
              {card.account && <span className="sub-mail">{card.account}</span>}
              <span
                className="sub-ring"
                title={pct !== null ? `남은 한도 ${pct}%` : '측정 없음'}
                style={{
                  background:
                    pct !== null
                      ? `conic-gradient(${pct <= 15 ? '#ff7b6e' : '#f2763a'} 0 ${pct}%, #2b231e ${pct}% 360deg)`
                      : '#252529',
                }}
              />
            </button>
          );
        }

        const hasBuckets = card.sections.some((s) => s.buckets.length > 0);
        return (
          <article className="sub-card" key={card.id}>
            <button
              type="button"
              className="sub-head sub-head-toggle"
              onClick={() => setOpenId(null)}
              aria-expanded={true}
            >
              <ChevronDown size={14} className="sub-chev" />
              {card.kind === 'codex' ? <Cpu size={15} /> : <Sparkles size={15} />}
              <span className="sub-name">{card.provider}</span>
              {card.plan && <span className="sub-plan">{card.plan}</span>}
              {card.active && <span className="sub-using">사용 중</span>}
              {card.account && <span className="sub-mail">{card.account}</span>}
            </button>

            {card.sections.map((section, sIdx) => (
              <div
                key={`${card.id}-sec-${sIdx}`}
                className={section.title ? 'sub-nested' : undefined}
              >
                {section.title && <div className="sub-nested-title">{section.title}</div>}
                {section.buckets.map((bucket, bIdx) => {
                  const prefixed = (bucket as AgyQuotaBucket & { prefix?: string }).prefix;
                  const label = windowLabel(bucket, prefixed);
                  const critical =
                    !bucket.disabled && bucket.remaining !== null && bucket.remaining <= 10;
                  return (
                    <div
                      className={`quota-window sub-window ${bucket.disabled ? 'disabled' : ''} ${
                        critical ? 'critical' : ''
                      }`}
                      key={`${card.id}-${sIdx}-${bucket.id}-${bIdx}`}
                    >
                      <div className="usage-row">
                        <span>{label}</span>
                        <span className="usage-pct">{remainingLabel(bucket)}</span>
                      </div>
                      {!bucket.disabled && (
                        <div
                          className="bar sub-bar"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={bucket.remaining ?? 0}
                          aria-label={`${card.provider} ${label} ${remainingLabel(bucket)}`}
                        >
                          <span
                            className="bar-fill"
                            style={{ width: `${bucket.remaining ?? 0}%` }}
                          />
                        </div>
                      )}
                      <div className="usage-reset">
                        {bucket.disabled
                          ? disabledLabel(bucket)
                          : resetLabel(bucket) || '초기화 시간이 제공되지 않았어요.'}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {!hasBuckets && (
              <div className="quota-empty">이 계정은 표시할 한도가 없어요.</div>
            )}
          </article>
        );
      })}
    </section>
  );
}
