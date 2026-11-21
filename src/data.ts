export type ComposerPanel = 'auto' | 'model' | 'reason' | 'context' | 'usage' | null;

export type InfoTab = 'info' | 'files' | 'diff' | 'git' | 'pin';

export type PinnedFile = {
  path: string;
  at: number;
  additions?: number;
  deletions?: number;
};

export const variantLabels: Record<string, string> = {
  none: '없음',
  minimal: '최소',
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
  max: '최대',
};

export const suggestions = [
  '이 프로젝트 구조를 파악해서 요약해줘',
  '테스트를 실행하고 실패한 부분을 고쳐줘',
  '최근 변경사항을 리뷰하고 개선점을 알려줘',
];

export function variantLabel(value: string) {
  return variantLabels[value] || value;
}

export function fmtClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function fmtDuration(seconds: number) {
  if (seconds < 1) return '0초';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}분 ${rest}초` : `${minutes}분`;
}

export function formatTokens(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) {
    const n = value / 1_000_000;
    return `${n >= 10 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    const n = value / 1_000;
    return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

export function shortPath(value?: string | null) {
  if (!value) return '~';
  const path = value.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
  if (path.length <= 42) return path;
  const parts = path.split('/');
  return `${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
}

export function baseName(value?: string | null) {
  if (!value) return 'agent studio';
  const trimmed = value.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

export function relativeTime(timestamp?: number) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return new Date(timestamp).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}

export function timeLabel(timestamp?: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function dayLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (diffDays <= 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return '지난 7일';
  if (diffDays < 30) return '지난 30일';
  return '이전';
}

const QUOTA_WARN_RE =
  /⚠?\s*Individual quota reached[^\n]*|(?:Please upgrade your subscription to increase your limits[^\n]*)|(?:You have hit your [^\n]*usage limit[^\n]*)|(?:rate limit reached[^\n]*)/gi;

export function isQuotaWarningLine(line: string): boolean {
  return /Individual quota reached|Please upgrade your subscription to increase your limits|You have hit your .*usage limit|rate limit reached|한도(?:가|를)?\s*(?:초과|소진|도달)/i.test(
    line || '',
  );
}

export function highlightQuotaWarningsHtml(html: string): string {
  if (!isQuotaWarningLine(html)) return html;
  return html.replace(
    QUOTA_WARN_RE,
    (match) => `<span class="quota-warn-inline">${match}</span>`,
  );
}

/**
 * Strip Orca / Agent Desk orchestration envelope lines from user messages so
 * the chat timeline shows only what the operator actually typed.
 */
export function cleanUserMessage(raw: string): string {
  const text = (raw || '').trim();
  if (!text) return '';
  if (
    !/^─+\s*From:/i.test(text) &&
    !/^Subject:\s*\[Desk\]/i.test(text) &&
    !/^\[(?:Agent Desk 공통 지시|워커 역할|코디네이터 역할)/i.test(text) &&
    !/\[진행 지시:/i.test(text)
  ) {
    return text;
  }
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (/^─{3,}(?:\s*From:.*)?$/i.test(trimmed)) continue;
    if (/^Subject:\s*\[Desk\]/i.test(trimmed)) continue;
    if (/^\[Reply:\s*orca orchestration reply\b/i.test(trimmed)) continue;
    if (/^\[Agent Desk 공통 지시.*\]\s*[-—:]*\s*$/i.test(trimmed)) continue;
    if (/^\[진행 지시:.*\]\s*$/i.test(trimmed)) continue;
    if (/^\[(워커|코디네이터|지휘자)\s*역할\]\s*$/i.test(trimmed)) continue;
    const attachMatch = trimmed.match(/^첨부 파일:\s*(.+)$/);
    if (attachMatch) {
      const fileName = attachMatch[1].trim().split('/').pop() || attachMatch[1].trim();
      kept.push(`[첨부: ${fileName}]`);
      continue;
    }
    kept.push(line);
  }
  while (kept[0] === '') kept.shift();
  while (kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n').trim() || text;
}
