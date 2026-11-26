import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import anime from 'animejs';
import { diffLines } from 'diff';
import type { File as AgentFile, FileDiff, ToolPart } from '@opencode-ai/sdk';
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  HardDrive,
  Maximize2,
  Minimize2,
  Pin,
  Radio,
  Sparkles,
  X,
} from 'lucide-react';
import { highlightCodeLines } from '../lib/markdown';
import { smoothScrollToBottom, cancelSmoothScroll } from '../lib/smoothScroll';
import type {
  AgentSession,
  AgyQuota,
  MessageWithParts,
  PathInfo,
  Tokens,
  VcsInfo,
} from '../lib/api';
import { contextTokens, sessionCost, sessionTokens } from '../lib/api';
import {
  formatTokens,
  relativeTime,
  shortPath,
  timeLabel,
  type InfoTab,
  type PinnedFile,
} from '../data';
import { QuotaSection, type CodexQuotaSnapshot } from './Quota';

export type TeamTreeAgent = {
  id: string;
  name: string;
  model?: string;
  role?: 'coordinator' | 'worker' | null;
  agent?: string;
  state?: string;
  inherit?: boolean;
  onSelect?: () => void;
};

type Props = {
  open: boolean;
  tab: InfoTab;
  onTab: (tab: InfoTab) => void;
  onClose: () => void;
  session: AgentSession | null;
  parentSession: AgentSession | null;
  messages: MessageWithParts[];
  diffs: FileDiff[];
  children: AgentSession[];
  gitFiles: AgentFile[];
  vcs: VcsInfo | null;
  pathInfo: PathInfo | null;
  providers: string;
  modelName: string;
  effort?: string;
  contextLimit: number;
  contextUsed?: number;
  tokenOverride?: Tokens;
  activeEngine?: string;
  codexQuota?: CodexQuotaSnapshot | null;
  teamAgents?: TeamTreeAgent[];
  quota: AgyQuota | null;
  quotaLoading: boolean;
  onRefreshQuota: () => void;
  pinned: PinnedFile[];
  onTogglePin: (file: PinnedFile) => void;
  onOpenSession: (id: string) => void;
  onToast: (message: string) => void;
  liveFiles?: LiveFileEntry[];
};

export function InfoPanel({
  open,
  tab,
  onTab,
  onClose,
  session,
  parentSession,
  messages,
  diffs,
  children,
  gitFiles,
  vcs,
  pathInfo,
  providers,
  modelName,
  effort,
  contextLimit,
  contextUsed,
  tokenOverride,
  activeEngine,
  codexQuota,
  teamAgents,
  quota,
  quotaLoading,
  onRefreshQuota,
  pinned,
  onTogglePin,
  onOpenSession,
  onToast,
  liveFiles,
}: Props) {
  const [mounted, setMounted] = useState(open);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const tabs = useMemo(
    () =>
      [
        { id: 'info' as const, label: '정보' },
        { id: 'files' as const, label: '파일', badge: diffs.length ? String(diffs.length) : undefined },
        { id: 'diff' as const, label: 'Diff', badge: diffs.length ? String(diffs.length) : undefined },
        { id: 'git' as const, label: 'Git', badge: gitFiles.length ? String(gitFiles.length) : undefined },
        { id: 'pin' as const, label: 'Pin', badge: pinned.length ? String(pinned.length) : undefined },
      ],
    [diffs.length, gitFiles.length, pinned.length],
  );

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    if (open) {
      anime({ targets: backdrop, opacity: [0, 1], duration: 260, easing: 'linear' });
      anime({
        targets: panel,
        translateX: ['100%', '0%'],
        duration: 400,
        easing: 'cubicBezier(0.22, 1, 0.36, 1)',
      });
    } else {
      anime({ targets: backdrop, opacity: [1, 0], duration: 220, easing: 'linear' });
      anime({
        targets: panel,
        translateX: ['0%', '100%'],
        duration: 300,
        easing: 'easeInCubic',
        complete: () => setMounted(false),
      });
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const host = bodyRef.current;
    if (!host) return;

    host.querySelectorAll<HTMLElement>('.bar-fill').forEach((bar, i) => {
      anime({
        targets: bar,
        scaleX: [0, 1],
        duration: 900,
        delay: 120 + i * 90,
        easing: 'easeOutCubic',
      });
    });

    anime({
      targets: host.querySelectorAll<HTMLElement>('.anim-row'),
      opacity: [0, 1],
      translateY: [8, 0],
      delay: anime.stagger(13, { start: 50 }),
      duration: 260,
      easing: 'easeOutQuad',
    });
  }, [open, mounted, tab, focusFile]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mounted, onClose]);

  if (!mounted) return null;

  const used = contextUsed ?? contextTokens(messages);
  const tokens = tokenOverride ?? sessionTokens(messages, session);
  const cost = sessionCost(messages, session);

  return createPortal(
    <div className="panel-layer">
      <div className="panel-backdrop" ref={backdropRef} onClick={onClose} />
      <aside className="info-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="세션 정보">
        <div className="info-head">
          <nav className="info-tabs" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={`info-tab ${tab === item.id ? 'active' : ''}`}
                onClick={() => onTab(item.id)}
              >
                <span>{item.label}</span>
                {item.badge && <span className="tab-badge">{item.badge}</span>}
              </button>
            ))}
          </nav>
          <button className="info-close" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        <div className="info-body" ref={bodyRef} key={`${tab}-${focusFile ?? ''}-${session?.id ?? 'none'}`}>
          {tab === 'info' && (
            <InfoTabContent
              session={session}
              parentSession={parentSession}
              messages={messages}
              children={children}
              used={used}
              limit={contextLimit}
              tokens={tokens}
              cost={cost}
              modelName={modelName}
              effort={effort}
              providers={providers}
              vcs={vcs}
              pathInfo={pathInfo}
              activeEngine={activeEngine}
              codexQuota={codexQuota}
              teamAgents={teamAgents}
              quota={quota}
              quotaLoading={quotaLoading}
              onRefreshQuota={onRefreshQuota}
              onOpenSession={onOpenSession}
              onToast={onToast}
            />
          )}
          {tab === 'files' && (
            <FilesTabContent
              diffs={diffs}
              gitFiles={gitFiles}
              messages={messages}
              liveFiles={liveFiles}
              pinned={pinned}
              onTogglePin={onTogglePin}
              onOpenDiff={(path) => {
                setFocusFile(path);
                onTab('diff');
              }}
            />
          )}
          {tab === 'diff' && (
            <DiffTabContent
              diffs={diffs}
              focusFile={focusFile}
              onClearFocus={() => setFocusFile(null)}
            />
          )}
          {tab === 'git' && (
            <GitTabContent vcs={vcs} files={gitFiles} pathInfo={pathInfo} onToast={onToast} />
          )}
          {tab === 'pin' && (
            <PinTabContent
              pins={pinned}
              diffs={diffs}
              onUnpin={onTogglePin}
              onOpen={(path) => {
                setFocusFile(path);
                onTab('diff');
              }}
            />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function InfoTabContent({
  session,
  parentSession,
  children,
  used,
  limit,
  tokens,
  cost,
  modelName,
  effort,
  providers,
  vcs,
  pathInfo,
  activeEngine,
  codexQuota,
  teamAgents,
  quota,
  quotaLoading,
  onRefreshQuota,
  onOpenSession,
  onToast,
}: {
  session: AgentSession | null;
  parentSession: AgentSession | null;
  messages: MessageWithParts[];
  children: AgentSession[];
  used: number;
  limit: number;
  tokens: Tokens;
  cost: number;
  modelName: string;
  effort?: string;
  providers: string;
  vcs: VcsInfo | null;
  pathInfo: PathInfo | null;
  activeEngine?: string;
  codexQuota?: CodexQuotaSnapshot | null;
  teamAgents?: TeamTreeAgent[];
  quota: AgyQuota | null;
  quotaLoading: boolean;
  onRefreshQuota: () => void;
  onOpenSession: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const directory = session?.directory || pathInfo?.worktree || '';
  const created = session?.time.created;
  const coordinatorNodes = (teamAgents || []).filter((a) => a.role === 'coordinator');
  const workerNodes = (teamAgents || []).filter((a) => a.role === 'worker');
  const cliNodes = (teamAgents || []).filter((a) => !a.role);
  const totalTreeCount = children.length + (teamAgents?.length || 0);

  const copyId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
      onToast('세션 ID를 복사했어요');
    } catch {
      onToast('복사할 수 없어요');
    }
  };

  if (!session) {
    return (
      <div className="info-stack">
        <QuotaSection
          quota={quota}
          loading={quotaLoading}
          onRefresh={onRefreshQuota}
          codexQuota={codexQuota}
          activeEngine={activeEngine}
        />
        <div className="tab-empty">
          <Bot size={26} />
          <p>세션을 선택하면 정보가 표시돼요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="info-stack">
      {limit > 0 && (
        <section className="ctx-block anim-row">
          <div className="info-label">컨텍스트</div>
          <div className="bar ctx-main-bar">
            <span className="bar-fill" style={{ width: `${Math.max(0.5, pct)}%` }} />
          </div>
          <div className="ctx-big">{pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</div>
          <div className="ctx-sub">
            {formatTokens(used)} / {formatTokens(limit)} 토큰
          </div>
        </section>
      )}

      <QuotaSection
        quota={quota}
        loading={quotaLoading}
        onRefresh={onRefreshQuota}
        codexQuota={codexQuota}
        activeEngine={activeEngine}
      />

      <section className="info-section">
        <div className="section-head">
          <h3 className="section-title">세션</h3>
          <button className="mini-action" onClick={copyId}>
            <Copy size={12} /> ID
          </button>
        </div>
        <div className="detail-card anim-row">
          <div className="detail-title">{session.title}</div>
          <div className="detail-row">
            <span className="detail-key">경로</span>
            <span className="detail-value mono" title={directory}>
              {shortPath(directory)}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-key">에이전트</span>
            <span className="detail-value">{session.agent || 'build'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">모델</span>
            <span className="detail-value">{modelName}{effort ? ` · ${effort}` : ''}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">시작</span>
            <span className="detail-value">
              {created ? `${relativeTime(created)} · ${timeLabel(created)}` : '—'}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-key">ID</span>
            <span className="detail-value mono">{session.id}</span>
          </div>
        </div>
      </section>

      <section className="info-section">
        <div className="section-head">
          <h3 className="section-title">런타임</h3>
        </div>
        <div className="runtime-grid">
          <div className="runtime-card anim-row">
            <HardDrive size={15} />
            <span className="runtime-k">제공자</span>
            <strong>{providers}</strong>
          </div>
          <div className="runtime-card anim-row">
            <GitBranch size={15} />
            <span className="runtime-k">브랜치</span>
            <strong>{vcs?.branch || '—'}</strong>
          </div>
          <div className="runtime-card anim-row">
            <Sparkles size={15} />
            <span className="runtime-k">비용</span>
            <strong>{cost > 0 ? `$${cost.toFixed(4)}` : '무료'}</strong>
          </div>
          <div className="runtime-card anim-row">
            <FileText size={15} />
            <span className="runtime-k">토큰</span>
            <strong>{formatTokens(tokens.input + tokens.output)}</strong>
          </div>
        </div>
      </section>

      {parentSession && (
        <section className="info-section">
          <h3 className="section-title">상위 세션</h3>
          <button className="tree-child anim-row parent-row" onClick={() => onOpenSession(parentSession.id)}>
            <span className="tree-child-name">{parentSession.title}</span>
            <span className="tree-child-meta">{relativeTime(parentSession.time.updated)}</span>
          </button>
        </section>
      )}

      <section className="info-section tree-section">
        <div className="section-head">
          <h3 className="section-title">서브에이전트 가계도</h3>
          <span className="section-count">{totalTreeCount}</span>
        </div>

        <div className="agent-tree">
          <div className="tree-root anim-row">
            <span className="tree-root-label">이 세션</span>
            <span className="tree-root-name">
              {modelName}
              {effort ? ` · ${effort}` : ''}
            </span>
          </div>

          {totalTreeCount === 0 ? (
            <div className="tree-empty anim-row">
              <Bot size={18} />
              <span>이 세션에서 생성된 서브에이전트가 아직 없어요.</span>
            </div>
          ) : (
            <div className="tree-groups">
              {(children.length > 0 || coordinatorNodes.length > 0) && (
                <div className="tree-group">
                  <div className="tree-group-head">
                    <span className="tone-square green" />
                    <span className="tree-group-label">
                      {coordinatorNodes.length > 0 ? '코디네이터' : '서브에이전트'}
                    </span>
                    <span className="tree-group-count">
                      {children.length + coordinatorNodes.length}
                    </span>
                  </div>
                  <ul className="tree-children">
                    {coordinatorNodes.map((node) => (
                      <li key={node.id}>
                        <button className="tree-child anim-row" onClick={node.onSelect}>
                          <span className="tree-child-name">{node.name}</span>
                          <span className="tree-child-meta">
                            {node.model || node.agent || 'coordinator'}
                          </span>
                          {node.inherit && (
                            <span className="tree-child-meta inherit">· 대화 상속</span>
                          )}
                          <ChevronRight size={13} className="tree-child-chev" />
                        </button>
                      </li>
                    ))}
                    {children.map((child) => (
                      <li key={child.id}>
                        <button
                          className="tree-child anim-row"
                          onClick={() => onOpenSession(child.id)}
                        >
                          <span className="tree-child-name">{child.title}</span>
                          <span className="tree-child-meta">
                            {child.summary?.files ? `${child.summary.files}개 파일 · ` : ''}
                            {relativeTime(child.time.updated)}
                          </span>
                          <ChevronRight size={13} className="tree-child-chev" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {workerNodes.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-head">
                    <span className="tone-square orange" />
                    <span className="tree-group-label">워커</span>
                    <span className="tree-group-count">{workerNodes.length}</span>
                  </div>
                  <ul className="tree-children">
                    {workerNodes.map((node) => (
                      <li key={node.id}>
                        <button className="tree-child anim-row" onClick={node.onSelect}>
                          <span className="tree-child-name">{node.name}</span>
                          <span className="tree-child-meta">
                            {node.model || node.agent || 'worker'}
                          </span>
                          {node.inherit && (
                            <span className="tree-child-meta inherit">↳ 상속</span>
                          )}
                          <ChevronRight size={13} className="tree-child-chev" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {cliNodes.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-head">
                    <span className="tone-square blue" />
                    <span className="tree-group-label">외부 CLI</span>
                    <span className="tree-group-count">{cliNodes.length}</span>
                  </div>
                  <ul className="tree-children">
                    {cliNodes.map((node) => (
                      <li key={node.id}>
                        <button className="tree-child anim-row" onClick={node.onSelect}>
                          <span className="tree-child-name">{node.name}</span>
                          <span className="tree-child-meta">
                            {node.model || `${node.agent || 'cli'} CLI`}
                          </span>
                          <ChevronRight size={13} className="tree-child-chev" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="session-foot-note anim-row">
        <CircleAlert size={13} />
        에이전트 도구는 이 워크스페이스에서 실제로 실행됩니다.
      </div>
    </div>
  );
}

function fileIcon(path: string) {
  if (path.endsWith('.json')) return <FileJson2 size={17} />;
  if (path.endsWith('.md')) return <FileText size={17} />;
  return <FileCode2 size={17} />;
}

export type LiveFileEntry = {
  path: string;
  name: string;
  status: 'writing' | 'saved';
  additions: number;
  deletions: number;
  before: string;
  after: string;
};

const FILE_TOOL_RE = /^(write|edit|multiedit|write_to_file|replace_file_content|multi_replace_file_content)$/i;

function extractLiveFileEntries(
  diffs: FileDiff[],
  messages: MessageWithParts[],
  gitFiles: AgentFile[] = [],
  liveFiles: LiveFileEntry[] = [],
): LiveFileEntry[] {
  const byPath = new Map<string, LiveFileEntry>();

  for (const lf of liveFiles) {
    byPath.set(lf.path, { ...lf });
  }

  for (const diff of diffs) {
    const existing = byPath.get(diff.file);
    if (existing && existing.status === 'writing') {
      if (!existing.before && diff.before) existing.before = diff.before;
      continue;
    }
    byPath.set(diff.file, {
      path: diff.file,
      name: diff.file.split('/').pop() || diff.file,
      status: 'saved',
      additions: diff.additions,
      deletions: diff.deletions,
      before: diff.before,
      after: diff.after,
    });
  }

  for (const gf of gitFiles) {
    if (!byPath.has(gf.path)) {
      byPath.set(gf.path, {
        path: gf.path,
        name: gf.path.split('/').pop() || gf.path,
        status: 'saved',
        additions: gf.added ?? 0,
        deletions: gf.removed ?? 0,
        before: '',
        after: '',
      });
    }
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool') continue;
      const toolPart = part as ToolPart;
      if (!FILE_TOOL_RE.test(toolPart.tool)) continue;
      const input = (toolPart.state.input || {}) as Record<string, unknown>;
      const rawPath =
        (typeof input.filePath === 'string' && input.filePath) ||
        (typeof input.path === 'string' && input.path) ||
        (typeof input.TargetFile === 'string' && input.TargetFile) ||
        (typeof input.file === 'string' && input.file) ||
        '';
      if (!rawPath) continue;

      const isRunning = toolPart.state.status === 'running' || toolPart.state.status === 'pending';
      const liveText =
        (typeof input.content === 'string' && input.content) ||
        (typeof input.CodeContent === 'string' && input.CodeContent) ||
        (typeof input.newString === 'string' && input.newString) ||
        (typeof input.ReplacementContent === 'string' && input.ReplacementContent) ||
        '';

      const existing = byPath.get(rawPath);
      if (existing) {
        if (isRunning) {
          existing.status = 'writing';
          if (liveText && liveText.length >= existing.after.length) {
            existing.after = liveText;
            existing.additions = Math.max(existing.additions, liveText.split('\n').length);
          }
        }
      } else if (liveText || isRunning) {
        const lineCount = liveText ? liveText.split('\n').length : 0;
        byPath.set(rawPath, {
          path: rawPath,
          name: rawPath.split('/').pop() || rawPath,
          status: isRunning ? 'writing' : 'saved',
          additions: lineCount,
          deletions: 0,
          before: '',
          after: liveText,
        });
      }
    }
  }

  return [...byPath.values()];
}

function fileBadgeExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (ext === 'ts' || ext === 'tsx') return 'TS';
  if (ext === 'js' || ext === 'jsx') return 'JS';
  if (ext === 'svelte' || ext === 'html' || ext === 'xml') return '<>';
  if (ext === 'css' || ext === 'scss') return '#';
  if (ext === 'json') return '{}';
  if (ext === 'db' || ext === 'sql') return 'DB';
  if (ext === 'md') return 'MD';
  return ext.slice(0, 3).toUpperCase() || 'FILE';
}

type FileTreeNode = {
  key: string;
  name: string;
  folders: FileTreeNode[];
  files: LiveFileEntry[];
};

function buildFileTree(entries: LiveFileEntry[]): FileTreeNode {
  const root: FileTreeNode = { key: '', name: '', folders: [], files: [] };
  const folderMap = new Map<string, FileTreeNode>([['', root]]);

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    const dirs = parts.slice(0, -1);
    let parentKey = '';
    for (const dir of dirs) {
      const nextKey = parentKey ? `${parentKey}/${dir}` : dir;
      if (!folderMap.has(nextKey)) {
        const node: FileTreeNode = { key: nextKey, name: dir, folders: [], files: [] };
        folderMap.set(nextKey, node);
        folderMap.get(parentKey)!.folders.push(node);
      }
      parentKey = nextKey;
    }
    folderMap.get(parentKey)!.files.push(entry);
  }
  return root;
}

function FilesTabContent({
  diffs,
  gitFiles,
  messages,
  liveFiles,
  pinned,
  onTogglePin,
  onOpenDiff,
}: {
  diffs: FileDiff[];
  gitFiles: AgentFile[];
  messages: MessageWithParts[];
  liveFiles?: LiveFileEntry[];
  pinned: PinnedFile[];
  onTogglePin: (file: PinnedFile) => void;
  onOpenDiff: (path: string) => void;
}) {
  const entries = useMemo(
    () => extractLiveFileEntries(diffs, messages, gitFiles, liveFiles),
    [diffs, messages, gitFiles, liveFiles],
  );
  const tree = useMemo(() => buildFileTree(entries), [entries]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [viewerOpen, setViewerOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(true);
  const codeBodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const toggleDir = (dirKey: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });
  };

  // Keep open tabs synced with modified/writing files and auto-focus active writes.
  useEffect(() => {
    if (entries.length === 0) return;
    setOpenTabs((prev) => {
      const next = [...prev];
      for (const entry of entries) {
        if (!next.includes(entry.path)) next.push(entry.path);
      }
      return next.slice(-8);
    });
    const writing = entries.find((e) => e.status === 'writing');
    if (writing) {
      setSelectedPath(writing.path);
      setViewerOpen(true);
    } else if (!selectedPath || !entries.some((e) => e.path === selectedPath)) {
      setSelectedPath(entries[0].path);
    }
  }, [entries, selectedPath]);

  const activeEntry = useMemo(
    () => entries.find((e) => e.path === selectedPath) ?? entries[0] ?? null,
    [entries, selectedPath],
  );

  const { lines, addedLines } = useMemo(() => {
    if (!activeEntry) return { lines: [] as string[], addedLines: new Set<number>() };
    const code = activeEntry.after || '';
    const highlighted = highlightCodeLines(code, activeEntry.path);
    const added = new Set<number>();
    if (activeEntry.before) {
      const changes = diffLines(activeEntry.before, code);
      let lineNo = 1;
      for (const change of changes) {
        const count = change.value.split('\n').length - (change.value.endsWith('\n') ? 1 : 0);
        if (change.added) {
          for (let i = 0; i < count; i += 1) added.add(lineNo + i);
        }
        if (!change.removed) lineNo += count;
      }
    } else if (code) {
      for (let i = 1; i <= highlighted.length; i += 1) added.add(i);
    }
    return { lines: highlighted, addedLines: added };
  }, [activeEntry]);

  // Smoothly follow newly modified/added lines while "따라가며" is enabled.
  useEffect(() => {
    if (!follow || !viewerOpen || !activeEntry) return;
    const el = codeBodyRef.current;
    if (!el) return;
    const addedNodes = el.querySelectorAll<HTMLElement>('.live-code-line.is-added');
    const lastAdded = addedNodes.length > 0 ? addedNodes[addedNodes.length - 1] : null;
    if (lastAdded && addedNodes.length < lines.length) {
      lastAdded.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      smoothScrollToBottom(el, { shouldContinue: () => followRef.current });
    }
  }, [follow, viewerOpen, activeEntry?.path, activeEntry?.after.length, lines.length]);

  const additions = entries.reduce((sum, item) => sum + item.additions, 0);
  const deletions = entries.reduce((sum, item) => sum + item.deletions, 0);

  if (entries.length === 0) {
    return <EmptyTab icon={<FileCode2 size={26} />} text="이 세션에서 수정된 파일이 아직 없어요." />;
  }

  const selectFile = (path: string) => {
    setSelectedPath(path);
    setViewerOpen(true);
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path].slice(-8)));
  };

  const closeTab = (path: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (selectedPath === path) {
        const fallback = next[next.length - 1] ?? null;
        setSelectedPath(fallback);
        if (!fallback) setViewerOpen(false);
      }
      return next;
    });
  };

  const renderTree = (node: FileTreeNode, depth = 0): ReactNode => (
    <>
      {node.folders.map((folder) => {
        const isOpen = !collapsedDirs.has(folder.key);
        return (
          <div className="file-tree-branch" key={folder.key}>
            <button
              type="button"
              className="file-tree-dir"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => toggleDir(folder.key)}
              aria-expanded={isOpen}
            >
              <ChevronRight size={13} className={`file-tree-chev ${isOpen ? 'open' : ''}`} />
              {isOpen ? <FolderOpen size={14} className="file-tree-folder-ico" /> : <Folder size={14} className="file-tree-folder-ico" />}
              <span>{folder.name}</span>
            </button>
            {isOpen && renderTree(folder, depth + 1)}
          </div>
        );
      })}
      {node.files.map((entry) => {
        const isPinned = pinned.some((pin) => pin.path === entry.path);
        const isSelected = activeEntry?.path === entry.path && viewerOpen;
        return (
          <div
            className={`file-row file-tree-row ${isSelected ? 'is-selected' : ''}`}
            key={entry.path}
            style={{ paddingLeft: `${depth * 14}px` }}
          >
            <button className="file-open" onClick={() => selectFile(entry.path)}>
              <span className="file-ico type-tsx">{fileIcon(entry.path)}</span>
              <span className="file-main">
                <span className="file-name">{entry.name}</span>
              </span>
              <span className={`file-status-pill ${entry.status}`}>
                {entry.status === 'writing' ? '작성 중' : '저장됨'}
              </span>
            </button>
            <button
              className={`file-pin ${isPinned ? 'active' : ''}`}
              onClick={() =>
                onTogglePin({
                  path: entry.path,
                  at: Date.now(),
                  additions: entry.additions,
                  deletions: entry.deletions,
                })
              }
              aria-label={isPinned ? '핀 해제' : '파일 핀'}
            >
              <Pin size={14} />
            </button>
          </div>
        );
      })}
    </>
  );

  return (
    <div className={`files-workspace ${expanded ? 'is-expanded' : ''}`}>
      {!expanded && (
        <div className="files-tree-pane">
          <div className="tab-summary anim-row">
            <span className="tab-summary-title">파일 탐색기</span>
            <span className="tab-summary-meta">
              {entries.length}개 · <em className="add">+{additions}</em>{' '}
              <em className="del">−{deletions}</em>
            </span>
          </div>
          <div className="file-list file-tree-list">{renderTree(tree)}</div>
        </div>
      )}

      {viewerOpen && activeEntry && (
        <section className="live-viewer" aria-label="라이브 코드 뷰어">
          <div className="live-viewer-head">
            <span className={`live-dot ${activeEntry.status}`} />
            <span className="live-viewer-name" title={activeEntry.path}>
              {activeEntry.name}
            </span>
            <span className="live-viewer-stat">
              {activeEntry.status === 'writing' ? '작성 중' : '저장됨'} · +{activeEntry.additions}
            </span>
            <div className="live-viewer-actions">
              <button
                type="button"
                className={`live-follow-btn ${follow ? 'active' : ''}`}
                onClick={() => setFollow((v) => !v)}
                title="새로 작성되는 줄을 자동으로 따라갑니다"
              >
                <Radio size={12} />
                <span>따라가며</span>
              </button>
              <button
                type="button"
                className="live-icon-btn"
                onClick={() => onOpenDiff(activeEntry.path)}
                title="Diff 탭에서 보기"
                aria-label="Diff 탭에서 보기"
              >
                <GitCompareArrows size={13} />
              </button>
              <button
                type="button"
                className="live-icon-btn"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? '분할 보기로 돌아가기' : '뷰어 확대'}
                aria-label={expanded ? '분할 보기로 돌아가기' : '뷰어 확대'}
              >
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <button
                type="button"
                className="live-icon-btn"
                onClick={() => {
                  setExpanded(false);
                  setViewerOpen(false);
                }}
                title="뷰어 닫기"
                aria-label="뷰어 닫기"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          <div
            className="live-viewer-body"
            ref={codeBodyRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              if (!atBottom && followRef.current) {
                setFollow(false);
                cancelSmoothScroll(el);
              }
            }}
          >
            {lines.length === 0 ? (
              <div className="live-viewer-empty">내용을 불러오는 중…</div>
            ) : (
              <div className="live-code">
                {lines.map((lineHtml, idx) => {
                  const no = idx + 1;
                  const isAdded = addedLines.has(no);
                  return (
                    <div className={`live-code-line ${isAdded ? 'is-added' : ''}`} key={no}>
                      <span className="live-code-n">{no}</span>
                      <code
                        className="hljs"
                        dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {openTabs.length > 0 && (
        <div className="file-tabs-dock" role="tablist" aria-label="열린 파일">
          {openTabs.map((path) => {
            const name = path.split('/').pop() || path;
            const active = activeEntry?.path === path && viewerOpen;
            return (
              <div className={`file-tab-pill ${active ? 'active' : ''}`} key={path}>
                <button
                  type="button"
                  className="file-tab-btn"
                  onClick={() => selectFile(path)}
                  title={path}
                >
                  <span className="file-tab-badge">{fileBadgeExt(path)}</span>
                  <span className="file-tab-name">{name}</span>
                </button>
                <button
                  type="button"
                  className="file-tab-close"
                  onClick={() => closeTab(path)}
                  aria-label={`${name} 닫기`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DiffRow = { type: 'add' | 'del' | 'ctx'; no: number; text: string };

function buildRows(before: string, after: string): DiffRow[] {
  const changes = diffLines(before, after);
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const change of changes) {
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (change.added) {
        rows.push({ type: 'add', no: newNo++, text: line });
      } else if (change.removed) {
        rows.push({ type: 'del', no: oldNo++, text: line });
      } else {
        rows.push({ type: 'ctx', no: newNo++, text: line });
        oldNo++;
      }
    }
  }
  return rows;
}

function DiffCard({ diff, expanded }: { diff: FileDiff; expanded: boolean }) {
  const rows = useMemo(() => buildRows(diff.before, diff.after), [diff.before, diff.after]);
  const visible = expanded ? rows : rows.slice(0, 200);
  return (
    <div className="diff-card anim-row">
      <div className="diff-head">
        <span className="diff-path">{diff.file}</span>
        <span className="diff-stats">
          <em className="add">+{diff.additions}</em>
          <em className="del">−{diff.deletions}</em>
        </span>
      </div>
      <div className="diff-lines">
        {visible.map((row, index) => (
          <div className={`diff-line ${row.type}`} key={`${row.type}-${index}-${row.text.slice(0, 12)}`}>
            <span className="diff-n">{row.no}</span>
            <span className="diff-sign">
              {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
            </span>
            <code>{row.text}</code>
          </div>
        ))}
        {rows.length === 0 && <div className="diff-empty">차이가 없어요</div>}
      </div>
      {!expanded && rows.length > 200 && (
        <div className="diff-more">… {rows.length - 200}줄 더 있음</div>
      )}
    </div>
  );
}

function DiffTabContent({
  diffs,
  focusFile,
  onClearFocus,
}: {
  diffs: FileDiff[];
  focusFile: string | null;
  onClearFocus: () => void;
}) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const focus = focusFile ? diffs.find((diff) => diff.file === focusFile) : null;
  const visible = focus ? [focus] : showAll ? diffs : diffs.slice(0, 3);

  if (diffs.length === 0) {
    return <EmptyTab icon={<FolderGit2 size={26} />} text="이 세션에서 생성된 Diff가 아직 없어요." />;
  }

  const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

  return (
    <div className="tab-stack">
      <div className="diff-summary anim-row">
        <span>
          <strong>{diffs.length}</strong>개 파일 변경됨
        </span>
        <span className="diff-stats">
          <em className="add">+{additions}</em>
          <em className="del">−{deletions}</em>
        </span>
      </div>
      {focusFile && (
        <button className="focus-chip anim-row" onClick={onClearFocus}>
          <X size={12} /> 전체 Diff 보기
        </button>
      )}
      {visible.map((diff) => (
        <div key={diff.file} onClick={() => setExpandedFile(diff.file)}>
          <DiffCard diff={diff} expanded={expandedFile === diff.file || diff.before.length < 8000} />
        </div>
      ))}
      {!focus && !showAll && diffs.length > 3 && (
        <button className="ghost-btn anim-row" onClick={() => setShowAll(true)}>
          나머지 {diffs.length - 3}개 파일 보기
        </button>
      )}
    </div>
  );
}

function GitTabContent({
  vcs,
  files,
  pathInfo,
  onToast,
}: {
  vcs: VcsInfo | null;
  files: AgentFile[];
  pathInfo: PathInfo | null;
  onToast: (message: string) => void;
}) {
  const copyBranch = async () => {
    if (!vcs?.branch) return;
    try {
      await navigator.clipboard.writeText(vcs.branch);
      onToast('브랜치 이름을 복사했어요');
    } catch {
      onToast('복사할 수 없어요');
    }
  };

  return (
    <div className="tab-stack">
      <div className="git-branch-card anim-row">
        <div className="git-branch-row">
          <button className="git-branch-pill" onClick={copyBranch}>
            <GitBranch size={13} />
            {vcs?.branch || '브랜치 없음'}
          </button>
          <span className={`git-clean ${files.length > 0 ? 'dirty' : ''}`}>
            {files.length > 0 ? `${files.length}개 변경됨` : '작업 트리 깨끗함'}
          </span>
        </div>
        <div className="git-sync">{shortPath(pathInfo?.worktree || vcs?.default_branch || '')}</div>
      </div>

      <div className="tab-summary anim-row">
        <span className="tab-summary-title">변경된 파일</span>
        <span className="tab-summary-meta">{files.length}</span>
      </div>

      {files.length === 0 ? (
        <div className="git-empty anim-row">
          <Check size={16} />
          커밋하지 않은 변경사항이 없어요.
        </div>
      ) : (
        <div className="commit-list">
          {files.map((file) => (
            <div className="commit-row anim-row static" key={file.path}>
              <span className={`commit-dot status-${file.status}`} />
              <span className="commit-main">
                <span className="commit-msg">{file.path}</span>
                <span className="commit-sub">
                  <code>{file.status}</code>
                  <span>·</span>
                  <span>
                    <em className="add">+{file.added}</em>{' '}
                    <em className="del">−{file.removed}</em>
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PinTabContent({
  pins,
  diffs,
  onUnpin,
  onOpen,
}: {
  pins: PinnedFile[];
  diffs: FileDiff[];
  onUnpin: (file: PinnedFile) => void;
  onOpen: (path: string) => void;
}) {
  if (pins.length === 0) {
    return <EmptyTab icon={<Pin size={26} />} text="핀한 파일이 없어요. 파일 탭에서 핀 아이콘을 눌러보세요." />;
  }

  return (
    <div className="tab-stack">
      <div className="tab-summary anim-row">
        <span className="tab-summary-title">핀한 파일</span>
        <span className="tab-summary-meta">{pins.length}</span>
      </div>
      {pins.map((pin) => {
        const diff = diffs.find((item) => item.file === pin.path);
        return (
          <div className="pin-card anim-row" key={pin.path}>
            <div className="pin-card-head">
              <Pin size={14} />
              <button className="pin-open" onClick={() => onOpen(pin.path)}>
                {pin.path}
              </button>
              <span className="pin-time">{relativeTime(pin.at)}</span>
            </div>
            <div className="pin-card-foot">
              <span>
                {diff ? (
                  <>
                    <em className="add">+{diff.additions}</em>{' '}
                    <em className="del">−{diff.deletions}</em>
                  </>
                ) : (
                  'Diff 없음'
                )}
              </span>
              <button className="mini-action" onClick={() => onUnpin(pin)}>
                해제
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyTab({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="tab-empty">
      {icon}
      <p>{text}</p>
    </div>
  );
}
