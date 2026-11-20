import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clipboard,
  Clock3,
  ExternalLink,
  FileText,
  FolderPlus,
  Github,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Menu,
  MessageSquare,
  Minus,
  Play,
  Pause,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Sparkles,
  SquareTerminal,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useAgyQuota } from '../hooks/useQuota';
import {
  orcaApi,
  type FreebuffUsage,
  type GithubInfo,
  type GithubWorkflow,
  type InstructionsInfo,
  type DeskMessage,
  type MemoryInfo,
  type MessagePayload,
  type OrcaAgent,
  type OrcaOverview,
  type OrcaProject,
  type OrcaWorktree,
  type TerminalSnapshot,
  type TranscriptPayload,
} from '../lib/orca';
import { relativeTime, shortPath } from '../data';
import { Sheet } from './Sheet';
import { SelectMenu } from './SelectMenu';

type DeskTab = 'agents' | 'github' | 'instructions' | 'memory' | 'messages';
type RunMode = 'single' | 'parallel';

const AGENT_OPTIONS = [
  { id: 'freebuff', label: 'Freebuff', short: 'FB', cls: 'freebuff' },
  { id: 'opencode', label: 'OpenCode', short: 'OC', cls: 'opencode' },
  { id: 'antigravity', label: 'Agy', short: 'AGY', cls: 'agy' },
  { id: 'gemini', label: 'Gemini', short: 'GM', cls: 'gemini' },
  { id: 'codex', label: 'Codex', short: 'CX', cls: 'codex' },
];

type ModelOption = { id: string; label: string };

// Model ids are taken from the local agent CLIs. Freebuff does not accept a
// launch-time model, so it is intentionally absent here.
const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  opencode: [
    { id: 'opencode/big-pickle', label: 'Big Pickle' },
    { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash' },
    { id: 'opencode/beam-free', label: 'Beam' },
    { id: 'opencode/flint-40b-free', label: 'Flint 40B' },
    { id: 'opencode/hy4-flash-free', label: 'HY4 Flash' },
    { id: 'opencode/iceman-free', label: 'Iceman' },
    { id: 'opencode/longcat-2.5-free', label: 'LongCat 2.5' },
    { id: 'opencode/mimo-v2.6-flash-free', label: 'MiMo V2.6 Flash' },
    { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning' },
    { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL' },
    { id: 'opencode/tidepool-alpha-free', label: 'Tidepool Alpha' },
  ],
  antigravity: [
    { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
    { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
    { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
    { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
    { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
    { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  gemini: [
    { id: 'auto', label: 'Auto (권장)' },
    { id: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  ],
};

function modelOptions(agent: string) {
  return MODEL_OPTIONS[agent] ?? [];
}

function modelName(agent: string, id: string) {
  if (!id) return '기본 모델';
  return modelOptions(agent).find((option) => option.id === id)?.label ?? id;
}

const TABS: { id: DeskTab; label: string }[] = [
  { id: 'agents', label: '에이전트' },
  { id: 'github', label: 'GitHub' },
  { id: 'instructions', label: '지침서' },
  { id: 'memory', label: '기억' },
  { id: 'messages', label: '메시지' },
];

function agentMeta(id: string) {
  if (id === 'terminal') {
    return { id, label: 'Shell', short: 'SH', cls: 'shell' };
  }
  return AGENT_OPTIONS.find((item) => item.id === id) || {
    id,
    label: id || 'Agent',
    short: (id || 'A').slice(0, 2).toUpperCase(),
    cls: 'other',
  };
}

function stateLabel(state: string) {
  if (state === 'working') return '작업 중';
  if (state === 'waiting') return '응답 대기';
  if (state === 'done') return '완료';
  if (state === 'error') return '오류';
  return '대기';
}

function runLabel(run: GithubInfo['latestRun']) {
  if (!run) return '실행 기록 없음';
  if (run.status === 'in_progress') return '실행 중';
  if (run.status === 'queued') return '대기열';
  if (run.conclusion === 'success') return '성공';
  if (run.conclusion === 'failure') return '실패';
  if (run.conclusion === 'cancelled') return '취소됨';
  return run.conclusion || run.status;
}

function isRunGood(run: GithubInfo['latestRun']) {
  return run?.conclusion === 'success';
}

function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  return { notice, notify };
}

export function ParallelDesk({ onClose }: { onClose: () => void }) {
  const [overview, setOverview] = useState<OrcaOverview | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [tab, setTab] = useState<DeskTab>('agents');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sideOpen, setSideOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [logAgent, setLogAgent] = useState<OrcaAgent | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { notice, notify } = useNotice();
  const loadingRef = useRef(false);

  const load = useCallback(
    async (force = false, quiet = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!quiet) setLoading(true);
      try {
        const next = await orcaApi.overview(force);
        setOverview(next);
        setError(null);
        setSelectedPath((current) => {
          if (current && next.worktrees.some((worktree) => worktree.path === current)) {
            return current;
          }
          return (
            next.worktrees.find((worktree) => worktree.path === next.currentPath)?.path ||
            next.worktrees[0]?.path ||
            null
          );
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Orca 런타임에 연결하지 못했습니다.');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false, true);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedWorktree = useMemo(
    () => overview?.worktrees.find((worktree) => worktree.path === selectedPath) || null,
    [overview, selectedPath],
  );

  const openWorktreeTerminal = useCallback(async () => {
    if (!selectedWorktree || openingTerminal) return;
    setOpeningTerminal(true);
    try {
      const result = await orcaApi.createTerminal(
        selectedWorktree.path,
        `${selectedWorktree.displayName} · shell`,
      );
      setOverview(result.overview);
      setLogAgent({
        id: `terminal:${result.handle}`,
        orcaSessionId: null,
        agent: 'terminal',
        state: 'done',
        title: result.title || `${selectedWorktree.displayName} 터미널`,
        prompt: '',
        worktreeId: selectedWorktree.id,
        repo: selectedWorktree.repo,
        path: selectedWorktree.path,
        branch: selectedWorktree.branch,
        terminalHandle: result.handle,
        terminalTitle: result.title,
        terminalPreview: '',
        terminalConnected: true,
        updatedAt: Date.now(),
        interrupted: false,
      });
      notify(`${selectedWorktree.displayName} 워크트리에 셸 터미널을 열었어요`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '터미널을 열지 못했어요');
    } finally {
      setOpeningTerminal(false);
    }
  }, [notify, openingTerminal, selectedWorktree]);

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (overview?.projects || [])
      .map((project) => ({
        ...project,
        worktrees: project.worktrees.filter((worktree) => {
          if (!needle) return true;
          return (
            project.repo.toLowerCase().includes(needle) ||
            worktree.displayName.toLowerCase().includes(needle) ||
            worktree.branch.toLowerCase().includes(needle) ||
            worktree.path.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((project) => project.worktrees.length > 0);
  }, [overview, query]);

  const openLog = useCallback((agent: OrcaAgent) => {
    setLogAgent(agent);
  }, []);

  const removeWorktree = useCallback(
    async (worktree: OrcaWorktree) => {
      if (removingId) return;
      if (
        !window.confirm(
          `'${worktree.displayName}' 워크트리를 Orca에서 삭제할까요?\n\n커밋하지 않은 변경도 사라질 수 있습니다. 실행 중인 터미널은 함께 종료됩니다.`,
        )
      ) {
        return;
      }
      setRemovingId(worktree.id);
      try {
        const result = await orcaApi.removeWorktree(worktree.id);
        setOverview(result.overview);
        setSelectedPath((current) => (current === worktree.path ? null : current));
        notify('워크트리를 삭제했어요');
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : '워크트리를 삭제하지 못했어요');
      } finally {
        setRemovingId(null);
      }
    },
    [notify, removingId],
  );

  const hideProject = useCallback(
    async (project: OrcaProject) => {
      if (removingId) return;
      if (
        !window.confirm(
          `'${project.repo}' 프로젝트를 Orca 사이드바에서 숨길까요?\n\n실행 중인 터미널과 파일은 유지됩니다.`,
        )
      ) {
        return;
      }
      setRemovingId(project.id);
      try {
        const result = await orcaApi.hideProject(project.id);
        setOverview(result.overview);
        setSelectedPath((current) =>
          result.overview.worktrees.some((worktree) => worktree.path === current)
            ? current
            : null,
        );
        notify('프로젝트를 사이드바에서 숨겼어요');
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : '프로젝트를 숨기지 못했어요');
      } finally {
        setRemovingId(null);
      }
    },
    [notify, removingId],
  );

  if (loading && !overview) {
    return (
      <div className="desk-stage">
        <div className="desk-boot">
          <span className="desk-boot-mark">
            <Boxes size={22} />
          </span>
          <div>
            <strong>병렬 데스크를 여는 중</strong>
            <span>Orca 워크트리와 에이전트를 불러옵니다.</span>
          </div>
          <Loader2 size={18} className="spin" />
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="desk-stage">
        <div className="desk-boot desk-boot-error">
          <AlertTriangle size={22} />
          <div>
            <strong>Orca 런타임에 연결할 수 없어요</strong>
            <span>{error}</span>
          </div>
          <button className="desk-btn" onClick={() => void load(true)}>
            <RefreshCw size={14} /> 다시 연결
          </button>
          <button className="desk-icon" onClick={onClose} aria-label="채팅으로 돌아가기">
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="desk-stage">
      <div className="desk-shell">
        <div
          className={`desk-side-backdrop ${sideOpen ? 'open' : ''}`}
          onClick={() => setSideOpen(false)}
        />
        <aside className={`desk-sidebar ${sideOpen ? 'open' : ''}`}>
          <div className="desk-side-head">
            <div className="desk-side-brand">
              <span className="desk-brand-mark">
                <Boxes size={17} />
              </span>
              <div>
                <strong>Parallel Desk</strong>
                <span>Orca · {overview?.host || 'local'}</span>
              </div>
            </div>
            <button className="desk-icon desk-side-close" onClick={() => setSideOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="desk-side-summary">
            <span>
              <b>{overview?.counts.projects || 0}</b> 프로젝트
            </span>
            <span>
              <b>{overview?.counts.worktrees || 0}</b> 워크트리
            </span>
            <span className="hot">
              <b>{overview?.counts.working || 0}</b> 작업 중
            </span>
          </div>

          <label className="desk-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트 · 워크트리 검색"
              spellCheck={false}
            />
          </label>

          <div className="desk-project-list">
            {projects.length === 0 && (
              <div className="desk-side-empty">
                <Search size={20} />
                <span>검색 결과가 없어요.</span>
              </div>
            )}
            {projects.map((project) => (
              <section className="desk-project" key={project.id}>
                <div className="desk-project-head">
                  <span className="desk-project-name">
                    <span className="desk-project-ico">{project.repo.slice(0, 1).toUpperCase()}</span>
                    {project.repo}
                  </span>
                  <span className="desk-project-count">{project.worktrees.length}</span>
                  <button
                    className="desk-project-hide"
                    onClick={() => void hideProject(project)}
                    disabled={removingId === project.id}
                    title="프로젝트 숨기기"
                    aria-label={`${project.repo} 프로젝트 숨기기`}
                  >
                    {removingId === project.id ? (
                      <Loader2 size={11} className="spin" />
                    ) : (
                      <Trash2 size={11} />
                    )}
                  </button>
                </div>
                <div className="desk-worktrees">
                  {project.worktrees.map((worktree) => {
                    const working = worktree.agents.filter(
                      (agent) => agent.state === 'working',
                    ).length;
                    return (
                      <div
                        key={worktree.path}
                        className={`desk-worktree ${
                          selectedPath === worktree.path ? 'active' : ''
                        }`}
                      >
                        <button
                          className="desk-worktree-open"
                          onClick={() => {
                            setSelectedPath(worktree.path);
                            setSideOpen(false);
                          }}
                        >
                          <span className={`desk-status-dot ${worktree.status}`} />
                          <span className="desk-worktree-main">
                            <span className="desk-worktree-name">
                              {worktree.displayName}
                              {worktree.isMainWorktree &&
                                worktree.displayName.toLowerCase() !== 'main' && <em>main</em>}
                            </span>
                            <span className="desk-worktree-meta">
                              {worktree.branch || shortPath(worktree.path)}
                            </span>
                          </span>
                          {working > 0 ? (
                            <span className="desk-worktree-live">{working}</span>
                          ) : (
                            <span className="desk-worktree-agents">{worktree.agents.length}</span>
                          )}
                        </button>
                        <button
                          className="desk-worktree-del"
                          onClick={() => void removeWorktree(worktree)}
                          disabled={removingId === worktree.id}
                          title="워크트리 삭제"
                          aria-label={`${worktree.displayName} 워크트리 삭제`}
                        >
                          {removingId === worktree.id ? (
                            <Loader2 size={11} className="spin" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="desk-side-foot">
            <button className="desk-add-project" onClick={() => setAddOpen(true)}>
              <FolderPlus size={16} />
              프로젝트 추가
            </button>
            <button className="desk-side-link" onClick={() => setCreditsOpen(true)}>
              <Sparkles size={14} />
              크레딧 · 런타임
              <ChevronRight size={13} />
            </button>
          </div>
        </aside>

        <main className="desk-main">
          <header className="desk-top">
            <button
              className="desk-icon desk-mobile-menu"
              onClick={() => setSideOpen(true)}
              aria-label="워크스페이스 열기"
            >
              <Menu size={20} />
            </button>
            <div className="desk-main-title">
              <span className="desk-title-mark">
                <GitCommitHorizontal size={15} />
              </span>
              <div>
                <strong>병렬 작업 콘솔</strong>
                <span>{overview?.counts.working || 0}개 에이전트가 움직이는 중</span>
              </div>
            </div>
            <div className="desk-top-actions">
              <button className="desk-btn ghost" onClick={() => setCreditsOpen(true)}>
                <Sparkles size={14} />
                <span>크레딧</span>
              </button>
              <button
                className="desk-icon"
                onClick={() => void load(true)}
                aria-label="새로고침"
                title="새로고침"
              >
                <RefreshCw size={17} className={loading ? 'spin' : ''} />
              </button>
              <button
                className="desk-btn chat-back"
                onClick={onClose}
                aria-label="일반 채팅으로 돌아가기"
                title="일반 채팅으로 돌아가기"
              >
                <ArrowLeft size={14} />
                <span>일반 채팅</span>
              </button>
            </div>
          </header>

          <div className="desk-scroll">
            {error && overview && (
              <div className="desk-banner" role="alert">
                <AlertTriangle size={15} />
                <span>{error}</span>
                <button onClick={() => void load(true)}>다시 시도</button>
              </div>
            )}

            <div className="desk-context">
              <div className="desk-context-main">
                <div className="desk-crumb">
                  <span>{selectedWorktree?.repo || '프로젝트'}</span>
                  <ChevronRight size={13} />
                  <strong>{selectedWorktree?.displayName || '워크트리 선택'}</strong>
                  {selectedWorktree?.isMainWorktree &&
                    selectedWorktree.displayName.toLowerCase() !== 'main' && <em>main</em>}
                </div>
                <div className="desk-path" title={selectedWorktree?.path}>
                  <Terminal size={12} />
                  {selectedWorktree ? shortPath(selectedWorktree.path) : '왼쪽에서 워크트리를 선택하세요'}
                </div>
              </div>
              {selectedWorktree && (
                <div className="desk-context-meta">
                  <span>
                    <GitBranch size={13} />
                    {selectedWorktree.branch || 'detached'}
                  </span>
                  <span>
                    <Bot size={13} />
                    {selectedWorktree.agents.length} agents
                  </span>
                  {selectedWorktree.liveTerminalCount > 0 && (
                    <span className="live">
                      <CircleDot size={11} />
                      {selectedWorktree.liveTerminalCount} terminals
                    </span>
                  )}
                  <button
                    type="button"
                    className="desk-btn ghost small desk-open-terminal"
                    onClick={() => void openWorktreeTerminal()}
                    disabled={openingTerminal}
                    title="이 워크트리에 셸 터미널 열기"
                  >
                    {openingTerminal ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <SquareTerminal size={12} />
                    )}
                    {openingTerminal ? '여는 중' : '터미널'}
                  </button>
                </div>
              )}
            </div>

            <nav className="desk-tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={tab === item.id}
                  className={`desk-tab ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === 'agents' && (
                    <span>{selectedWorktree?.agents.length || 0}</span>
                  )}
                </button>
              ))}
            </nav>

            {tab === 'agents' && selectedWorktree && (
              <AgentsTab
                worktree={selectedWorktree}
                overview={overview}
                onLog={openLog}
                onOverview={setOverview}
                notify={notify}
              />
            )}
            {tab === 'agents' && !selectedWorktree && (
              <DeskEmpty
                icon={<Boxes size={26} />}
                title="워크트리를 선택해 주세요"
                text="왼쪽에서 프로젝트를 고르면 에이전트를 띄울 수 있어요."
              />
            )}
            {tab === 'github' && selectedWorktree && (
              <GithubTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'instructions' && selectedWorktree && (
              <InstructionsTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'memory' && selectedWorktree && (
              <MemoryTab path={selectedWorktree.path} notify={notify} />
            )}
            {tab === 'messages' && <MessagesTab overview={overview} notify={notify} />}
            {(tab === 'github' || tab === 'instructions' || tab === 'memory') &&
              !selectedWorktree && (
                <DeskEmpty
                  icon={<Boxes size={26} />}
                  title="워크트리를 선택해 주세요"
                  text="프로젝트를 선택하면 이 탭을 사용할 수 있어요."
                />
              )}
          </div>
        </main>
      </div>

      {logAgent && (
        <LogDrawer
          agent={logAgent}
          onClose={() => setLogAgent(null)}
          onOverview={setOverview}
        />
      )}
      {creditsOpen && (
        <CreditsDrawer overview={overview} onClose={() => setCreditsOpen(false)} />
      )}
      {addOpen && (
        <AddProjectDialog
          onClose={() => setAddOpen(false)}
          onAdded={(next, path) => {
            setOverview(next);
            if (path) setSelectedPath(path);
            setAddOpen(false);
            notify('프로젝트를 Orca에 추가했어요');
          }}
        />
      )}

      {notice && (
        <div className="desk-notice" role="status">
          <Check size={13} strokeWidth={3} />
          {notice}
        </div>
      )}
    </div>
  );
}

function DeskEmpty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="desk-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AgentsTab({
  worktree,
  overview,
  onLog,
  onOverview,
  notify,
}: {
  worktree: OrcaWorktree;
  overview: OrcaOverview | null;
  onLog: (agent: OrcaAgent) => void;
  onOverview: (overview: OrcaOverview) => void;
  notify: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [agentType, setAgentType] = useState('freebuff');
  const [count, setCount] = useState(1);
  const [runMode, setRunMode] = useState<RunMode>('single');
  const [advanced, setAdvanced] = useState(false);
  const [isolate, setIsolate] = useState(true);
  const [workerModel, setWorkerModel] = useState('');
  const [coordinatorModel, setCoordinatorModel] = useState('');
  const [modelTarget, setModelTarget] = useState<'worker' | 'coordinator' | null>(null);
  const [launching, setLaunching] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    setWorkerModel('');
    setCoordinatorModel('');
    setModelTarget(null);
  }, [agentType]);

  const chooseModel = (id: string) => {
    if (modelTarget === 'coordinator') setCoordinatorModel(id);
    if (modelTarget === 'worker') setWorkerModel(id);
    setModelTarget(null);
  };

  const isSingle = runMode === 'single';
  const running = worktree.agents.filter((agent) => agent.state === 'working').length;
  const waiting = worktree.agents.filter((agent) => agent.state === 'waiting').length;

  const launch = async (blank = false) => {
    if ((!blank && !prompt.trim()) || launching) return;
    setLaunching(true);
    setFailures([]);
    try {
      const result = await orcaApi.launch({
        path: worktree.path,
        prompt: blank ? '' : prompt.trim(),
        blank,
        agent: agentType,
        count: blank ? 1 : isSingle ? 1 : count,
        isolate,
        team: blank ? false : !isSingle,
        workerModel: workerModel.trim(),
        coordinatorModel: isSingle ? '' : coordinatorModel.trim(),
      });
      if (result.overview) onOverview(result.overview);
      const launched = [
        ...result.launches,
        ...(result.coordinator ? [result.coordinator] : []),
      ];
      const success = launched.filter((launchResult) => launchResult.ok);
      const workerSuccess = result.launches.filter((launchResult) => launchResult.ok).length;
      if (success.length) {
        if (!blank) setPrompt('');
        notify(
          blank
            ? `${agentMeta(agentType).label} 세션을 열었어요`
            : isSingle
              ? `${agentMeta(agentType).label} 1명을 ${
                  isolate ? '새 워크트리에서 ' : ''
                }시작했어요`
              : `지휘자 1명 + 워커 ${workerSuccess}명을 ${
                  isolate ? '분리된 워크트리에서 ' : ''
                }시작했어요`,
        );
        // "세션만 열기" should land in the session that was just created,
        // not leave the user on the launch form.
        if (blank) {
          const launched = success[0];
          const nextAgent = (result.overview?.agents || overview?.agents || []).find(
            (item) => launched.handle && item.terminalHandle === launched.handle,
          );
          if (nextAgent) {
            onLog(nextAgent);
          } else if (launched.handle) {
            onLog({
              id: `launch:${launched.handle}`,
              orcaSessionId: null,
              agent: launched.agent || agentType,
              state: 'working',
              title: `${agentMeta(agentType).label} 세션`,
              prompt: '',
              worktreeId: launched.worktreeId || worktree.id,
              repo: worktree.repo,
              path: launched.path || worktree.path,
              branch: worktree.branch,
              terminalHandle: launched.handle,
              terminalTitle: `${agentMeta(agentType).label} 세션`,
              terminalPreview: '',
              terminalConnected: true,
              updatedAt: Date.now(),
              interrupted: false,
            });
          }
        }
      }
      const failed = launched
        .filter((launchResult) => !launchResult.ok)
        .map((launchResult) => launchResult.error || '실행에 실패했어요');
      if (failed.length) {
        setFailures(failed);
        if (!success.length) notify(failed[0]);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '에이전트를 시작하지 못했어요';
      setFailures([message]);
      notify(message);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="desk-agents">
      <section className="desk-launch">
        <div className="desk-launch-head">
          <div>
            <span className="desk-kicker">
              <Zap size={12} /> {isSingle ? 'SINGLE RUN' : 'PARALLEL RUN'}
            </span>
            <h2>{isSingle ? '단일 에이전트로 시작' : '작업 한 줄로 팀 시작'}</h2>
            <p>
              {isSingle
                ? `지휘자 없이 ${agentMeta(agentType).label} 1명이 맡은 작업을 끝까지 진행합니다.`
                : '지휘자 1명이 워커에게 작업을 나눠 진행합니다.'}{' '}
              {isolate
                ? '새 워크트리에서 실행해 파일 충돌을 줄입니다.'
                : '같은 워크트리에서 실행합니다. 파일 충돌에 주의하세요.'}
            </p>
          </div>
          <span className="desk-launch-count">
            <b>{isSingle ? 1 : count + 1}</b>
            <span>{isSingle ? '1 agent' : `1 lead · ${count} workers`}</span>
          </span>
        </div>

        <div className="desk-run-modes" role="tablist" aria-label="실행 방식">
          <button
            type="button"
            role="tab"
            aria-selected={isSingle}
            className={`desk-run-mode ${isSingle ? 'active' : ''}`}
            onClick={() => setRunMode('single')}
          >
            <span className="desk-run-mode-ico"><Bot size={14} /></span>
            <span>
              <b>단일</b>
              <small>지휘자 없이 1명</small>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isSingle}
            className={`desk-run-mode ${!isSingle ? 'active' : ''}`}
            onClick={() => setRunMode('parallel')}
          >
            <span className="desk-run-mode-ico"><Boxes size={14} /></span>
            <span>
              <b>병렬</b>
              <small>지휘자 + 워커</small>
            </span>
          </button>
        </div>

        <textarea
          className="desk-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void launch();
            }
          }}
          placeholder="예: 로그인 화면의 접근성 문제를 찾아 고치고 테스트까지 실행해줘"
          rows={3}
        />

        <div className="desk-launch-controls simple">
          <div className="desk-launch-summary">
            <span className={`desk-agent-badge ${agentMeta(agentType).cls}`}>
              {agentMeta(agentType).short}
            </span>
            <span className="desk-launch-summary-main">
              <b>{agentMeta(agentType).label}</b>
              <small>
                {isSingle ? '지휘자 없이 단독 실행' : `지휘자 1 + 워커 ${count}`}
                {isolate ? ' · 새 워크트리' : ' · 현재 워크트리'}
              </small>
            </span>
            <button
              type="button"
              className={`desk-advanced-toggle ${advanced ? 'open' : ''}`}
              onClick={() => setAdvanced((value) => !value)}
              aria-expanded={advanced}
            >
              {advanced ? '간단히' : '고급 설정'}
              <ChevronDown size={13} />
            </button>
          </div>

          {advanced && (
            <div className="desk-advanced">
              <div className="desk-agent-choice" role="group" aria-label="에이전트 선택">
                {AGENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`desk-agent-tab ${agentType === option.id ? 'active' : ''} ${option.cls}`}
                    onClick={() => setAgentType(option.id)}
                  >
                    <span>{option.short}</span>
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="desk-advanced-row">
                {!isSingle && (
                  <>
                    <div className="desk-counter" aria-label="워커 수">
                      <button
                        onClick={() => setCount((value) => Math.max(1, value - 1))}
                        disabled={count <= 1}
                        aria-label="워커 줄이기"
                      >
                        <Minus size={13} />
                      </button>
                      <span>{count}</span>
                      <button
                        onClick={() => setCount((value) => Math.min(6, value + 1))}
                        disabled={count >= 6}
                        aria-label="워커 늘리기"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <small className="desk-counter-label">워커</small>
                  </>
                )}

                <label className="desk-check">
                  <input
                    type="checkbox"
                    checked={isolate}
                    onChange={(event) => setIsolate(event.target.checked)}
                  />
                  <span>
                    <b>새 워크트리</b>
                    <small>충돌 방지</small>
                  </span>
                </label>
              </div>

              {modelOptions(agentType).length > 0 ? (
                <div className="desk-model-row">
                  {!isSingle && (
                    <div className="desk-model-field">
                      <span>지휘자 모델</span>
                      <button
                        type="button"
                        className="desk-model-trigger"
                        onClick={() => setModelTarget('coordinator')}
                        aria-haspopup="dialog"
                        aria-label={`지휘자 모델 선택: ${modelName(agentType, coordinatorModel)}`}
                      >
                        <span>{modelName(agentType, coordinatorModel)}</span>
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  )}
                  <div className="desk-model-field">
                    <span>{isSingle ? '모델' : '워커 모델'}</span>
                    <button
                      type="button"
                      className="desk-model-trigger"
                      onClick={() => setModelTarget('worker')}
                      aria-haspopup="dialog"
                      aria-label={`${isSingle ? '모델' : '워커 모델'} 선택: ${modelName(agentType, workerModel)}`}
                    >
                      <span>{modelName(agentType, workerModel)}</span>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="desk-model-note">
                    <ShieldCheck size={11} /> 공통 지시서 · 자율 진행
                  </span>
                </div>
              ) : (
                <div className="desk-model-row">
                  <span className="desk-model-note">
                    <ShieldCheck size={11} />{' '}
                    {agentType === 'freebuff'
                      ? 'Freebuff는 실행 시 모델을 지정할 수 없어 자체 설정을 사용합니다.'
                      : agentType === 'codex'
                        ? 'Codex는 자체 로그인과 모델 설정을 사용합니다.'
                        : '모델을 지정하지 않으면 에이전트 기본값을 사용합니다.'}
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            className="desk-launch-btn"
            onClick={() => void launch()}
            disabled={!prompt.trim() || launching}
          >
            {launching ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {launching
              ? isSingle
                ? '시작 중…'
                : '팀 구성 중…'
              : isSingle
                ? '에이전트 1명 시작'
                : `지휘자 + ${count} 워커 시작`}
          </button>
          <button
            type="button"
            className="desk-session-only"
            onClick={() => void launch(true)}
            disabled={launching}
            title="명령 없이 에이전트 세션만 엽니다"
          >
            {launching ? <Loader2 size={13} className="spin" /> : <SquareTerminal size={13} />}
            세션만 열기
          </button>
        </div>
        {failures.length > 0 && (
          <div className="desk-launch-errors">
            {failures.slice(0, 3).map((failure, index) => (
              <div key={`${failure}-${index}`}>
                <AlertTriangle size={12} />
                {failure}
              </div>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={modelTarget !== null}
        onClose={() => setModelTarget(null)}
        label={
          modelTarget === 'coordinator'
            ? '지휘자 모델 선택'
            : isSingle
              ? '모델 선택'
              : '워커 모델 선택'
        }
      >
        <div className="sheet-content model-sheet desk-model-sheet">
          <div className="sheet-head">
            <span className="sheet-title">
              {modelTarget === 'coordinator' ? '지휘자 모델' : isSingle ? '모델' : '워커 모델'}
            </span>
            <span className="sheet-sub">{agentMeta(agentType).label}</span>
          </div>
          <div className="sheet-list">
            <button
              className={`sheet-row model-row ${(modelTarget === 'coordinator' ? coordinatorModel : workerModel) === '' ? 'selected' : ''}`}
              onClick={() => chooseModel('')}
            >
              <span className="model-name">기본 모델</span>
              <span className="row-provider">자동</span>
              {(modelTarget === 'coordinator' ? coordinatorModel : workerModel) === '' && (
                <span className="row-check"><Check size={12} /></span>
              )}
            </button>
            {modelOptions(agentType).map((option) => {
              const selected = (modelTarget === 'coordinator' ? coordinatorModel : workerModel) === option.id;
              return (
                <button
                  key={option.id}
                  className={`sheet-row model-row ${selected ? 'selected' : ''}`}
                  onClick={() => chooseModel(option.id)}
                >
                  <span className="model-name">{option.label}</span>
                  <span className="row-provider">{option.id}</span>
                  {selected && <span className="row-check"><Check size={12} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      <div className="desk-stat-row">
        <div>
          <span className="desk-stat-dot working" />
          <b>{running}</b>
          <span>작업 중</span>
        </div>
        <div>
          <span className="desk-stat-dot waiting" />
          <b>{waiting}</b>
          <span>응답 대기</span>
        </div>
        <div>
          <span className="desk-stat-dot done" />
          <b>{worktree.agents.length - running - waiting}</b>
          <span>완료 · 대기</span>
        </div>
        <div className="desk-stat-path" title={worktree.path}>
          <GitBranch size={13} />
          {worktree.branch || 'detached'}
        </div>
      </div>

      {worktree.agents.length === 0 ? (
        <DeskEmpty
          icon={<Bot size={27} />}
          title="아직 에이전트가 없어요"
          text="위에서 단일 또는 병렬 실행을 선택해 에이전트를 띄워보세요."
        />
      ) : (
        <div className="desk-agent-grid">
          {worktree.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onClick={() => onLog(agent)} />
          ))}
        </div>
      )}

      {overview && overview.agents.length > worktree.agents.length && (
        <div className="desk-other-projects">
          <div className="desk-subhead">
            <span>다른 워크트리에서 실행 중</span>
            <span>{overview.agents.length - worktree.agents.length}</span>
          </div>
          <div className="desk-mini-grid">
            {overview.agents
              .filter((agent) => agent.path !== worktree.path)
              .slice(0, 4)
              .map((agent) => (
                <button className="desk-mini-agent" key={agent.id} onClick={() => onLog(agent)}>
                  <span className={`desk-agent-badge ${agentMeta(agent.agent).cls}`}>
                    {agentMeta(agent.agent).short}
                  </span>
                  <span>
                    <b>{agentMeta(agent.agent).label}</b>
                    <small>{agent.repo} / {shortPath(agent.path)}</small>
                  </span>
                  <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, onClick }: { agent: OrcaAgent; onClick: () => void }) {
  const meta = agentMeta(agent.agent);
  return (
    <button className={`desk-agent-card ${agent.state}`} onClick={onClick}>
      <div className="desk-agent-card-head">
        <span className={`desk-agent-badge ${meta.cls}`}>{meta.short}</span>
        <span className="desk-agent-card-title">
          <b>{meta.label}</b>
          <small>{agent.terminalConnected ? '터미널 연결됨' : '터미널 없음'}</small>
        </span>
        <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
      </div>
      <strong className="desk-agent-name">{agent.title}</strong>
      {agent.prompt && agent.prompt !== agent.title && (
        <p className="desk-agent-prompt">{agent.prompt}</p>
      )}
      <div className="desk-agent-foot">
        <span>
          <Clock3 size={12} />
          {agent.updatedAt ? relativeTime(agent.updatedAt) : '방금'}
        </span>
        <span>
          <SquareTerminal size={12} />
          로그
        </span>
      </div>
    </button>
  );
}

function GithubTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitBusy, setCommitBusy] = useState<'commit' | 'push' | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await orcaApi.github(path);
      setInfo(next);
      setError(next.ok ? null : next.error || 'GitHub 정보를 불러오지 못했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'GitHub 정보를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const runWorkflow = async (workflow: GithubWorkflow) => {
    if (!info?.branch) return;
    if (!window.confirm(`${workflow.name} 워크플로를 ${info.branch} 브랜치에서 실행할까요?`)) {
      return;
    }
    setRunning(workflow.id);
    try {
      const result = await orcaApi.runWorkflow(path, workflow.id, info.branch);
      notify(result.message || '워크플로를 시작했어요');
      window.setTimeout(() => void load(), 3000);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '워크플로를 시작하지 못했어요');
    } finally {
      setRunning(null);
    }
  };

  const commitChanges = async (push: boolean) => {
    if (!commitMessage.trim() || commitBusy) return;
    setCommitBusy(push ? 'push' : 'commit');
    setCommitError(null);
    try {
      const result = await orcaApi.commitAndPush(path, commitMessage.trim(), push);
      if (result.ok) {
        notify(
          `커밋 ${result.commit?.hash || ''}${result.pushed ? ' · 푸시 완료' : ''}`.trim(),
        );
        setCommitMessage('');
        await load();
      } else {
        const reason = result.pushError || result.error || '푸시하지 못했어요.';
        setCommitError(reason);
        if (result.conflictNotice?.notified) {
          notify(`푸시 실패 · 충돌 해결을 ${result.conflictNotice.coordinator}에게 보냈어요`);
        } else {
          notify(reason);
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '커밋하지 못했어요.';
      setCommitError(message);
      notify(message);
    } finally {
      setCommitBusy(null);
    }
  };

  if (loading && !info) {
    return <DeskLoading text="GitHub 저장소와 Actions를 확인하는 중…" />;
  }

  if (!info?.connected) {
    return (
      <DeskEmpty
        icon={<Github size={27} />}
        title="GitHub 원격 저장소가 없어요"
        text={info?.error || '이 워크트리의 origin이 GitHub를 가리켜야 Actions와 CI를 사용할 수 있어요.'}
      />
    );
  }

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <Github size={12} /> GITHUB
          </span>
          <h2>{info.slug}</h2>
          <p>{info.path}</p>
          {info.account?.login && (
            <div className="desk-github-account" title={info.account.url || undefined}>
              <Github size={11} />
              @{info.account.login} 연결됨
            </div>
          )}
        </div>
        <div className="desk-panel-actions">
          <a className="desk-btn ghost" href={info.actionsUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Actions
          </a>
          <button className="desk-icon" onClick={() => void load()} aria-label="GitHub 새로고침">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="desk-banner">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <section className="desk-commit-panel">
        <div className="desk-commit-head">
          <span>
            <GitCommitHorizontal size={14} />
            커밋 & 푸시
          </span>
          <small>
            {info.branch} · 변경 {info.dirty ?? 0}개
          </small>
        </div>
        <div className="desk-commit-row">
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="커밋 메시지"
            maxLength={200}
            spellCheck={false}
          />
          <button
            className="desk-btn ghost small"
            onClick={() => void commitChanges(false)}
            disabled={!commitMessage.trim() || commitBusy !== null}
          >
            {commitBusy === 'commit' ? <Loader2 size={13} className="spin" /> : <GitCommitHorizontal size={13} />}
            커밋
          </button>
          <button
            className="desk-btn small"
            onClick={() => void commitChanges(true)}
            disabled={!commitMessage.trim() || commitBusy !== null}
          >
            {commitBusy === 'push' ? <Loader2 size={13} className="spin" /> : <GitBranch size={13} />}
            커밋 + 푸시
          </button>
        </div>
        <p className="desk-commit-hint">
          푸시가 충돌하면 지휘자 세션에 충돌 해결 메시지를 보냅니다. 강제 푸시는 하지 않습니다.
        </p>
        {commitError && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {commitError}
          </div>
        )}
      </section>

      <div className="desk-ci-grid">
        <div className="desk-ci-card">
          <span className="desk-ci-label">기준 브랜치 대비</span>
          <strong className={info.ahead ? 'warn' : ''}>
            {info.ahead === null || info.ahead === undefined
              ? '확인 불가'
              : info.ahead > 0
                ? `+${info.ahead} 커밋 앞섬`
                : '앞선 커밋 없음'}
          </strong>
          <small>
            {info.defaultBranch || 'main'}
            {info.behind ? ` · ${info.behind} 커밋 뒤짐` : ''}
            {info.dirty ? ` · 변경 ${info.dirty}개` : ''}
          </small>
        </div>
        <div className={`desk-ci-card ${isRunGood(info.latestRun) ? 'good' : ''}`}>
          <span className="desk-ci-label">최근 CI</span>
          <strong className={isRunGood(info.latestRun) ? 'good' : ''}>
            {runLabel(info.latestRun)}
          </strong>
          <small>
            {info.latestRun
              ? `${info.latestRun.workflowName} · ${info.latestRun.headBranch}`
              : '아직 실행 기록이 없어요'}
          </small>
        </div>
        <div className="desk-ci-card">
          <span className="desk-ci-label">현재 브랜치</span>
          <strong>{info.branch}</strong>
          <small>{info.workflows?.length || 0}개 워크플로</small>
        </div>
      </div>

      <div className="desk-subhead">
        <span>워크플로 · CI</span>
        <span>{(info.workflows || []).length}</span>
      </div>

      {(info.workflows || []).length === 0 ? (
        <DeskEmpty
          icon={<Github size={24} />}
          title="등록된 워크플로가 없어요"
          text="저장소에 .github/workflows가 있으면 여기서 바로 실행할 수 있어요."
        />
      ) : (
        <div className="desk-workflow-list">
          {(info.workflows || []).map((workflow) => (
            <div className="desk-workflow" key={workflow.id}>
              <span className="desk-workflow-ico">
                <Github size={15} />
              </span>
              <span className="desk-workflow-main">
                <b>{workflow.name}</b>
                <small>{workflow.path}</small>
              </span>
              <span className={`desk-workflow-state ${workflow.state}`}>{workflow.state}</span>
              <button
                className="desk-btn small"
                onClick={() => void runWorkflow(workflow)}
                disabled={running !== null || workflow.state !== 'active'}
              >
                {running === workflow.id ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Play size={13} />
                )}
                실행
              </button>
            </div>
          ))}
        </div>
      )}

      {info.latestRun && (
        <a
          className="desk-latest-run"
          href={info.latestRun.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className={`desk-run-dot ${info.latestRun.conclusion || info.latestRun.status}`} />
          <span>
            <b>{info.latestRun.displayTitle || info.latestRun.workflowName}</b>
            <small>
              {info.latestRun.workflowName} · {info.latestRun.headBranch} ·{' '}
              {relativeTime(new Date(info.latestRun.createdAt).getTime())}
            </small>
          </span>
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function InstructionsTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [data, setData] = useState<InstructionsInfo | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await orcaApi.instructions(path);
      setData(next);
      setContent(next.content);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '지침서를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await orcaApi.saveInstructions(path, content);
      setData(next);
      notify('워크트리 지침서를 저장했어요');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '지침서를 저장하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <DeskLoading text="워크트리 지침서를 읽는 중…" />;

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <BookOpen size={12} /> WORKTREE RULES
          </span>
          <h2>작업 지침서</h2>
          <p>이 워크트리의 AGENTS.md · 에이전트가 작업할 때 함께 읽습니다.</p>
        </div>
        <button className="desk-btn" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          저장
        </button>
      </div>
      {error && (
        <div className="desk-banner">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}
      <div className="desk-editor-meta">
        <span>
          <FileText size={13} />
          {data?.file || 'AGENTS.md'}
        </span>
        <span>{content.length.toLocaleString('ko-KR')}자</span>
      </div>
      <textarea
        className="desk-editor"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="# 작업 지침&#10;&#10;- 이 워크트리에서 지켜야 할 규칙을 적어 주세요.&#10;- 테스트와 검증 명령도 함께 적으면 좋아요."
        spellCheck={false}
      />
      <div className="desk-editor-foot">
        <span>
          <ShieldCheck size={13} />
          저장하면 이 워크트리에만 적용됩니다.
        </span>
        <button className="desk-btn ghost small" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={12} /> 되돌리기
        </button>
      </div>
    </div>
  );
}

function MemoryTab({ path, notify }: { path: string; notify: (message: string) => void }) {
  const [data, setData] = useState<MemoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await orcaApi.memory(path));
    } catch (cause) {
      setData({
        ok: false,
        path,
        recent: '',
        error: cause instanceof Error ? cause.message : '기억을 불러오지 못했어요.',
        fetchedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const next = await orcaApi.syncMemory(path);
      setData(next);
      notify(next.ok ? 'ai-memory 기록을 동기화했어요' : next.error || '동기화하지 못했어요');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : '동기화하지 못했어요');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="desk-panel-stack">
      <div className="desk-panel-head">
        <div>
          <span className="desk-kicker">
            <Sparkles size={12} /> AI-MEMORY
          </span>
          <h2>프로젝트 기억</h2>
          <p>이 워크트리에서 축적된 최근 위키 페이지와 동기화 상태입니다.</p>
        </div>
        <div className="desk-panel-actions">
          <button className="desk-btn ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 새로고침
          </button>
          <button className="desk-btn" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
            기억 동기화
          </button>
        </div>
      </div>

      <div className="desk-memory-status">
        <span className={`desk-status-dot ${data?.ok ? 'working' : 'error'}`} />
        {data?.ok ? 'ai-memory 연결됨' : data?.error || 'ai-memory 상태 확인 필요'}
        {data?.synced && <em>방금 동기화</em>}
      </div>

      {loading && !data && <DeskLoading text="ai-memory의 최근 기록을 읽는 중…" />}
      {!loading && data && (
        <pre className="desk-memory-output">
          {data.recent || '아직 이 워크트리에 기록된 기억이 없어요.'}
        </pre>
      )}
      <div className="desk-editor-foot">
        <span>
          <Zap size={13} />
          동기화는 ai-memory의 recover를 실행하고 최근 페이지를 다시 읽습니다.
        </span>
      </div>
    </div>
  );
}

function MessagesTab({
  overview,
  notify,
}: {
  overview: OrcaOverview | null;
  notify: (message: string) => void;
}) {
  const [payload, setPayload] = useState<MessagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toId, setToId] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const agents = overview?.agents.filter((agent) => agent.terminalHandle || agent.orcaSessionId) || [];
  const recipients = payload?.agents?.length ? payload.agents : agents;

  const load = useCallback(async () => {
    try {
      const next = await orcaApi.messages();
      setPayload(next);
    } catch (cause) {
      setPayload({
        ok: false,
        messages: [],
        error: cause instanceof Error ? cause.message : '메시지를 불러오지 못했어요.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!toId && recipients[0]?.id) setToId(recipients[0].id);
  }, [toId, recipients]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || !toId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const next = await orcaApi.sendMessage({ text: text.trim(), toId });
      setPayload(next);
      setText('');
      if (next.error) {
        setSendError(next.error);
      } else {
        notify('메시지를 작업자 세션에 전달했어요');
      }
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '메시지를 전달하지 못했어요');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="desk-message-layout">
      <section className="desk-message-main">
        <div className="desk-panel-head">
          <div>
            <span className="desk-kicker">
              <MessageSquare size={12} /> ORCA INBOX
            </span>
            <h2>작업자 메시지</h2>
            <p>Orca orchestration inbox를 읽고, 특정 작업자 세션으로 직접 보냅니다.</p>
          </div>
          <button className="desk-icon" onClick={() => void load()} aria-label="메시지 새로고침">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>

        <form className="desk-message-compose" onSubmit={send}>
          <div className="desk-message-route">
            <label>
              받는 작업자
              <SelectMenu
                value={toId}
                onChange={setToId}
                ariaLabel="받는 작업자"
                placeholder={recipients.length ? '작업자 선택' : '연결된 작업자가 없습니다'}
                options={recipients.map((agent) => ({
                  value: agent.id,
                  label: `${agentMeta(agent.agent).label} · ${agent.title.slice(0, 42)}`,
                  description: `${shortPath(agent.path)} · ${stateLabel(agent.state)}`,
                  meta: relativeTime(agent.updatedAt ?? undefined),
                }))}
              />
            </label>
            <span className="desk-message-arrow">→</span>
            <label>
              보내는 곳
              <span className="desk-message-static">Desk</span>
            </label>
          </div>
          <div className="desk-message-input">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="작업자 세션에 전달할 메시지"
              rows={2}
            />
            <button
              type="submit"
              className="desk-btn"
              disabled={!text.trim() || !toId || sending}
            >
              {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              전송
            </button>
          </div>
          <div className="desk-message-hint">
            <ShieldCheck size={12} />
            `orca orchestration send`로 실제 세션에 전달합니다. Freebuff·OpenCode 모두 해당됩니다.
          </div>
          {sendError && (
            <div className="desk-banner">
              <AlertTriangle size={14} />
              {sendError}
            </div>
          )}
        </form>

        <div className="desk-inbox-note">
          <ShieldCheck size={12} />
          받은 메시지는 Orca inbox에서, 보낸 메시지는 로컬 기록에서 함께 표시합니다.
        </div>

        <div className="desk-subhead">
          <span>받은 메시지</span>
          <span>{payload?.messages.length || 0}</span>
        </div>
        {payload?.warning && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {payload.warning}
          </div>
        )}
        {payload && !payload.ok && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {payload.error}
          </div>
        )}
        {!payload || payload.messages.length === 0 ? (
          <DeskEmpty
            icon={<MessageSquare size={25} />}
            title="아직 받은 메시지가 없어요"
            text="지휘자와 워커가 Orca orchestration으로 메시지를 주고받으면 여기에 표시됩니다."
          />
        ) : (
          <div className="desk-message-list">
            {[...payload.messages].reverse().map((message: DeskMessage) => {
              const fromAgent = agents.find((agent) => agent.id === message.fromId);
              return (
                <article
                  className={`desk-message inbox ${message.handled ? 'handled' : 'unread'}`}
                  key={message.id}
                >
                  <div className="desk-message-head">
                    <span className={`desk-agent-badge ${agentMeta(fromAgent?.agent || '').cls}`}>
                      {message.fromName.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <b>{message.fromName}</b>
                      <small>
                        → {message.toName}
                        {message.at
                          ? ` · ${relativeTime(new Date(message.at).getTime())}`
                          : ' · Orca inbox'}
                      </small>
                    </span>
                    <span className="desk-delivery ok">{message.type}</span>
                  </div>
                  {message.subject && <strong className="desk-message-subject">{message.subject}</strong>}
                  <p>{message.text}</p>
                  {!message.handled && <small className="desk-message-unread">아직 읽지 않음</small>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <aside className="desk-roster">
        <div className="desk-subhead">
          <span>작업자 명단</span>
          <span>{agents.length}</span>
        </div>
        {agents.length === 0 ? (
          <div className="desk-roster-empty">메시지를 받을 터미널이 아직 없어요.</div>
        ) : (
          agents.map((agent) => (
            <div
              className="desk-roster-item"
              key={agent.id}
              title={`${agent.repo} / ${agent.path}`}
            >
              <span className={`desk-agent-badge ${agentMeta(agent.agent).cls}`}>
                {agentMeta(agent.agent).short}
              </span>
              <span>
                <b>{agentMeta(agent.agent).label}</b>
                <small>{agent.title.slice(0, 48)}</small>
              </span>
              <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}

function DeskLoading({ text }: { text: string }) {
  return (
    <div className="desk-loading">
      <Loader2 size={17} className="spin" />
      {text}
    </div>
  );
}

function TranscriptMarkdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }) as string, {
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['style', 'form', 'input'],
      }),
    [text],
  );
  return <div className="md desk-transcript-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

type FreebuffModel = {
  id: string;
  label: string;
  hours: number;
  effort: string;
};

const FREEBUFF_MODELS: FreebuffModel[] = [
  {
    id: 'deepseek-v4.1-flash-fast',
    label: 'DeepSeek V4.1 Flash Fast',
    hours: 3,
    effort: 'High / Max 선택',
  },
  {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    hours: 2,
    effort: 'High / Max 선택',
  },
  {
    id: 'deepseek-v4.1-flash-slow',
    label: 'DeepSeek V4.1 Flash Slow',
    hours: 1,
    effort: 'Low 고정',
  },
];

function remainingUntilLabel(value?: string | null): string | null {
  if (!value) return null;
  const until = new Date(value).getTime();
  if (Number.isNaN(until)) return null;
  const minutes = Math.max(0, Math.round((until - Date.now()) / 60_000));
  if (minutes < 1) return '곧 리셋';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}일 ${hours % 24}시간 남음`;
  }
  return hours > 0 ? `${hours}시간 ${rest}분 남음` : `${rest}분 남음`;
}

function cleanFreebuffTail(lines: string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of lines) {
    let line = raw
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r$/, '')
      .trimEnd();
    if (!line.trim()) {
      if (cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    if (
      /Ad \[Report|revana\.si|openllm\.sh|seedance|generate ai|access coding agents|run coding agents|developer-f|connect revana|scale your video|start generating|try .*free/i.test(
        line,
      )
    ) {
      continue;
    }
    if (
      /Enter a coding task|Add to the current task|for history|for help|End session|DeepSeek V4\.1 Flash Fast|model to change|Show\s+\d+\s+more\s+lines?|Show\s+more\s+lines?|·\s*Chat:|(?:thinking|working)\.\.\.|\b\d+[hm]\s+left\b/i.test(
        line,
      )
    ) {
      continue;
    }
    if (/^\s*[█▀▄]/.test(line)) continue;
    if (
      /May use data for AI training|Session active|\d+\/\d+ hours remaining|Starter plan|\d+ day streak|Streak perk|^\s*[│╭╰╮╯─]+\s*$/.test(
        line,
      )
    ) {
      continue;
    }
    if (/^[╭╰╮╯─]+$/.test(line.trim())) continue;
    if (!line.replace(/[│╭╰╮╯─\s]/g, '')) continue;
    line = line.replace(/^[│]\s?/, '').replace(/\s*[│]$/, '').trimEnd();
    if (/^(?:[⎘•△▽█✕■]|•\s*\d+s)/.test(line.trim())) continue;
    if (/^(?:[>›❯]|←)\s*$/.test(line.trim())) continue;
    cleaned.push(line);
  }
  while (cleaned[0] === '') cleaned.shift();
  while (cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned;
}

function terminalLineClass(line: string) {
  if (/-?\s*Thinking\b|추론\s*상황/i.test(line)) return 'thinking';
  if (/^\s*\$\s/.test(line)) return 'command';
  if (/^\s*\[\d{1,2}:\d{2}\s*(?:AM|PM)\]/i.test(line)) return 'stamp';
  return '';
}

function terminalBlocks(lines: string[]) {
  const blocks: { kind: 'text' | 'thinking' | 'command' | 'stamp'; lines: string[] }[] = [];
  let inThinking = false;
  for (const line of lines) {
    const explicit = terminalLineClass(line);
    // Freebuff prints the gray reasoning block under `• Thinking` with a
    // deeper indent than the answer. Keep those wrapped lines in the same
    // gray block instead of leaking them into the normal answer.
    const reasoningLine = inThinking && /^\s{4,}\S/.test(line);
    const kind = (explicit || (reasoningLine ? 'thinking' : 'text')) as
      | 'text'
      | 'thinking'
      | 'command'
      | 'stamp';
    if (explicit === 'thinking') inThinking = true;
    else if (kind === 'text' && /^\s{0,3}\S/.test(line)) inThinking = false;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }
  return blocks;
}

function freebuffStatus(lines: string[], working: boolean) {
  const joined = lines.join(' ');
  return {
    left: joined.match(/(\d+h(?:\s*\d+m)?|\d+m(?:\s*\d+s)?)\s+left\b/i)?.[1] ?? null,
    planLeft: joined.match(/(\d+\/\d+)\s+hours remaining/i)?.[1] ?? null,
    model: joined.match(/DeepSeek V4\.1 Flash(?: Fast| Slow)?/i)?.[0] ?? null,
    effort: joined.match(/(?:•|·|effort[:=]?)\s*(max|high|low)\b/i)?.[1]?.toLowerCase() ?? null,
    context: joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[1] ?? null,
    contextPercent: Number(
      joined.match(/(\d+(?:\.\d+)?[KkMm]?)\s*\(\s*(\d+(?:\.\d+)?)%\s*\)/)?.[2] ?? NaN,
    ),
    elapsed: joined.match(/(?:thinking|working)\.\.\.\s*(\d+m\s*\d+s|\d+m|\d+s)/i)?.[1] ?? null,
    thinking: working,
  };
}

function LogDrawer({
  agent,
  onClose,
  onOverview,
}: {
  agent: OrcaAgent;
  onClose: () => void;
  onOverview: (overview: OrcaOverview) => void;
}) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [view, setView] = useState<'chat' | 'terminal'>('chat');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ path: string; name: string; size: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFreebuff =
    agent.agent === 'freebuff' ||
    (agent.agent === 'agent' && /Freebuff/i.test(agent.title));
  const isShell = agent.agent === 'terminal';
  const transcriptEntries = useMemo(
    () =>
      (transcript?.entries || []).filter(
        (entry) =>
          (entry.kind === 'message' ||
            entry.kind === 'reasoning' ||
            entry.kind === 'thinking' ||
            entry.kind === 'tool') &&
          typeof entry.text === 'string' &&
          entry.text.trim(),
      ),
    [transcript],
  );
  const hasTranscript = transcriptEntries.length > 0;
  const isThinking = transcript ? transcript.state === 'working' : agent.state === 'working';
  const displayTail = useMemo(
    () => (isFreebuff ? cleanFreebuffTail(snapshot?.tail ?? []) : snapshot?.tail ?? []),
    [isFreebuff, snapshot],
  );
  const displayBlocks = useMemo(() => terminalBlocks(displayTail), [displayTail]);
  const freebuffMeta = useMemo(
    () => freebuffStatus(snapshot?.tail ?? [], agent.state === 'working'),
    [agent.state, snapshot],
  );

  const load = useCallback(async () => {
    if (!agent.terminalHandle && !agent.orcaSessionId) {
      setError('이 에이전트의 터미널 핸들을 찾지 못했습니다.');
      setLoading(false);
      return;
    }
    if (agent.terminalHandle) {
      try {
        const next = await orcaApi.terminal(agent.terminalHandle, {
          screen: !isFreebuff,
          limit: isFreebuff ? 2000 : 800,
        });
        setSnapshot(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '로그를 읽지 못했어요.');
      }
    }
    if (agent.orcaSessionId) {
      void orcaApi
        .transcript(agent.orcaSessionId)
        .then(setTranscript)
        .catch(() => undefined);
    }
    setLoading(false);
  }, [agent.terminalHandle, agent.orcaSessionId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 1800);
    return () => window.clearInterval(timer);
  }, [load]);

  /* keep the transcript fresh even when the terminal read is slow */
  useEffect(() => {
    if (!agent.orcaSessionId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void orcaApi
          .transcript(agent.orcaSessionId!)
          .then(setTranscript)
          .catch(() => undefined);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [agent.orcaSessionId]);

  useEffect(() => {
    // A Freebuff terminal can keep running after Orca's transcript stops
    // updating. Prefer the live terminal for it; the user can still switch
    // back to the last Orca transcript with the toggle.
    setView(isFreebuff || isShell ? 'terminal' : 'chat');
  }, [isFreebuff, isShell, agent.terminalHandle]);

  useEffect(() => {
    if (!follow) return;
    const el = bodyRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    // The transcript arrives asynchronously after the terminal snapshot, so
    // scroll again after React has painted the new message/reasoning blocks.
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    const timer = window.setTimeout(scrollToBottom, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [snapshot, transcript, transcriptEntries.length, view, follow]);

  const copy = async () => {
    if (!snapshot && !hasTranscript) return;
    const copyText =
      view === 'chat' && hasTranscript
        ? transcriptEntries
            .map((entry) => `${entry.role === 'user' ? 'YOU' : 'AGENT'}: ${entry.text}`)
            .join('\n\n')
        : displayTail.join('\n');
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard can fail silently
    }
  };

  const sendNative = async (command: string) => {
    if (!agent.terminalHandle || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await orcaApi.sendTerminal(agent.terminalHandle, command);
      if (!sent.ok) throw new Error(sent.error || '터미널 입력을 전달하지 못했어요.');
      setSent(true);
      setLastSent(command);
      setView('terminal');
      window.setTimeout(() => setSent(false), 1600);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '네이티브 명령을 전달하지 못했어요.');
    } finally {
      setSending(false);
    }
  };

  const attachData = async (name: string, data: string) => {
    setAttaching(true);
    setSendError(null);
    try {
      const result = await orcaApi.attach({ name, data });
      setAttachment({ path: result.path, name: result.name, size: result.size });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '파일을 저장하지 못했어요.');
    } finally {
      setAttaching(false);
    }
  };

  const attachFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setSendError('파일은 20MB 이하만 전송할 수 있어요.');
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
      reader.readAsDataURL(file);
    }).catch((cause: unknown) => {
      setSendError(cause instanceof Error ? cause.message : '파일을 읽지 못했어요.');
      return '';
    });
    if (!data) return;
    await attachData(file.name, data);
  };

  const attachUrl = async () => {
    const url = window.prompt('다운로드할 파일 URL을 입력하세요.');
    if (!url?.trim()) return;
    setAttaching(true);
    setSendError(null);
    try {
      const result = await orcaApi.attachUrl(url.trim());
      setAttachment({ path: result.path, name: result.name, size: result.size });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : 'URL에서 파일을 받지 못했어요.');
    } finally {
      setAttaching(false);
    }
  };

  const sendReply = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = [reply.trim(), attachment ? `첨부 파일: ${attachment.path}` : '']
      .filter(Boolean)
      .join('\n\n');
    if (!text || sending) return;
    const toId = agent.terminalHandle || agent.id;
    if (!toId) {
      setSendError('메시지를 받을 세션을 찾지 못했어요.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      // Freebuff's TUI input is the reliable path for an already-open parallel
      // worktree terminal. Orchestration is kept as a fallback for older hosts.
      if ((isFreebuff || isShell) && agent.terminalHandle) {
        const sent = await orcaApi.sendTerminal(agent.terminalHandle, text, {
          focus: isFreebuff,
          waitSubmit: isFreebuff,
        });
        if (!sent.ok) throw new Error(sent.error || '터미널 입력을 전달하지 못했어요.');
      } else {
        const result = await orcaApi.sendMessage({ text, toId });
        if (result.ok === false || result.error) {
          throw new Error(result.error || 'Freebuff 세션에 메시지를 전달하지 못했어요.');
        }
      }
      setReply('');
      setAttachment(null);
      setSent(true);
      setLastSent(text);
      setView(isFreebuff || isShell ? 'terminal' : 'chat');
      window.setTimeout(() => setSent(false), 1600);
      const refresh = () => {
        if (agent.orcaSessionId) {
          void orcaApi.transcript(agent.orcaSessionId).then(setTranscript).catch(() => undefined);
        }
      };
      window.setTimeout(refresh, 700);
      window.setTimeout(refresh, 2200);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '메시지를 전달하지 못했어요.');
    } finally {
      setSending(false);
    }
  };

  const interrupt = async () => {
    if (!agent.terminalHandle || interrupting) return;
    setInterrupting(true);
    setSendError(null);
    try {
      const result = await orcaApi.interrupt(agent.terminalHandle);
      if (!result.ok) throw new Error(result.error || '중단 신호를 보내지 못했어요.');
      setInterrupted(true);
      window.setTimeout(() => setInterrupted(false), 1800);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : '중단하지 못했어요.');
    } finally {
      setInterrupting(false);
    }
  };

  const terminate = async () => {
    if (!agent.terminalHandle || closing) return;
    if (!window.confirm('이 터미널을 종료할까요? 실행 중인 에이전트 작업이 중단됩니다.')) return;
    setClosing(true);
    try {
      const result = await orcaApi.closeTerminal(agent.terminalHandle);
      onOverview(result.overview);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '터미널을 종료하지 못했어요.');
    } finally {
      setClosing(false);
    }
  };

  return createPortal(
    <div className="desk-drawer-layer">
      <div className="desk-drawer-backdrop" onClick={onClose} />
      <aside className="desk-log-panel" role="dialog" aria-modal="true" aria-label="에이전트 로그">
        <div className="desk-log-head">
          <div className="desk-log-title">
            <span className={`desk-agent-badge ${agentMeta(agent.agent).cls}`}>
              {agentMeta(agent.agent).short}
            </span>
            <div>
              <strong>{agent.title}</strong>
              <span>
                {agentMeta(agent.agent).label} · {agent.repo} / {agent.path.split('/').pop()}
              </span>
            </div>
          </div>
          <div className="desk-log-actions">
            <button
              className="desk-btn ghost small"
              onClick={() => void copy()}
              disabled={!snapshot && !hasTranscript}
            >
              {copied ? <Check size={13} /> : <Clipboard size={13} />}
              {copied ? '복사됨' : '복사'}
            </button>
            <button className="desk-icon" onClick={() => void load()} aria-label="로그 새로고침">
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
            {isFreebuff && (
              <button
                className="desk-btn ghost small"
                onClick={() => void interrupt()}
                disabled={interrupting || !agent.terminalHandle}
                title="현재 작업 중단 (Ctrl+C)"
              >
                {interrupting ? <Loader2 size={13} className="spin" /> : <Pause size={13} />}
                {interrupted ? '중단됨' : '중단'}
              </button>
            )}
            <button
              className="desk-btn danger small"
              onClick={() => void terminate()}
              disabled={closing || !agent.terminalHandle}
              title="터미널 종료"
            >
              {closing ? <Loader2 size={13} className="spin" /> : <Power size={13} />}
              종료
            </button>
            <button className="desk-icon" onClick={onClose} aria-label="로그 닫기">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="desk-log-meta">
          <span className={`desk-state ${agent.state}`}>{stateLabel(agent.state)}</span>
          <span className={snapshot?.status === 'running' ? 'live' : ''}>
            <span className="desk-status-dot working" />
            {snapshot?.status || 'reading'}
          </span>
          <span>
            {view === 'chat' && hasTranscript
              ? `Orca 세션 기록${transcript?.state ? ` · ${transcript.state}` : ''}`
              : snapshot?.source || 'screen'}
          </span>
          <span>handle {agent.terminalHandle?.replace('term_', '').slice(0, 8) || '—'}</span>
          {hasTranscript && (
            <span className="desk-log-view-toggle">
              <button
                className={view === 'chat' ? 'active' : ''}
                onClick={() => setView('chat')}
              >
                대화
              </button>
              <button
                className={view === 'terminal' ? 'active' : ''}
                onClick={() => setView('terminal')}
              >
                터미널
              </button>
            </span>
          )}
          <button
            className={`desk-follow ${follow ? 'active' : ''}`}
            onClick={() => setFollow((value) => !value)}
          >
            자동 따라가기
          </button>
        </div>

        {isFreebuff && (
          <>
            <div className="desk-log-freebuff-status">
              <span className={`desk-log-thinking ${isThinking ? 'active' : ''}`}>
                {isThinking ? '작업 중...' : '대기'}
              </span>
              {freebuffMeta.planLeft && <span>사용 가능 {freebuffMeta.planLeft}시간</span>}
              {isThinking && freebuffMeta.elapsed && <span>경과 {freebuffMeta.elapsed}</span>}
              <span className="desk-log-esc">
                <kbd>Esc</kbd> 세션 종료
              </span>
            </div>

            <section className="desk-freebuff-usage" aria-label="Freebuff 사용량">
              <div className="desk-freebuff-usage-head">
                <span>
                  <Activity size={12} /> 사용량
                </span>
                <button
                  type="button"
                  onClick={() => void sendNative('/model')}
                  disabled={!agent.terminalHandle || sending}
                  title="Freebuff 네이티브 /model 피커 열기"
                >
                  /model로 모델 변경
                </button>
              </div>
              <div className="desk-freebuff-usage-row">
                <span>컨텍스트</span>
                <strong>
                  {freebuffMeta.context
                    ? `${freebuffMeta.context}${Number.isFinite(freebuffMeta.contextPercent) ? ` (${freebuffMeta.contextPercent}%)` : ''}`
                    : '작업이 끝나면 표시'}
                </strong>
              </div>
              <div className="bar desk-freebuff-context-bar">
                <span
                  className="bar-fill"
                  style={{
                    width: `${Number.isFinite(freebuffMeta.contextPercent) ? Math.min(100, Math.max(0, freebuffMeta.contextPercent)) : 0}%`,
                  }}
                />
              </div>
              <div className="desk-freebuff-usage-row">
                <span>사용 가능 시간</span>
                <strong>{freebuffMeta.planLeft ? `${freebuffMeta.planLeft}시간` : '—'}</strong>
              </div>
              <div className="desk-freebuff-usage-meta">
                <span>모델 {freebuffMeta.model || '—'}</span>
                <span>effort {freebuffMeta.effort || '—'}</span>
                <span>매일 초기화</span>
              </div>
              <p>사용 가능 시간은 분 카운트다운이 아니라 오늘 남은 시간입니다 · 토큰·추론은 CLI가 노출하지 않습니다.</p>
            </section>

            <details className="desk-freebuff-model-guide">
              <summary>모델 3종 · 1시간 세션 기준</summary>
              <div>
                {FREEBUFF_MODELS.map((freebuffModel) => (
                  <div className="desk-freebuff-model" key={freebuffModel.id}>
                    <strong>{freebuffModel.label}</strong>
                    <span>{freebuffModel.hours}시간 · {freebuffModel.effort}</span>
                  </div>
                ))}
              </div>
              <p>/model은 Freebuff 네이티브 명령입니다. 모델을 바꾸면 picker가 열립니다.</p>
            </details>
          </>
        )}

        {error && !hasTranscript ? (
          <div className="desk-log-error">
            <AlertTriangle size={18} />
            <strong>로그를 읽을 수 없어요</strong>
            <p>{error}</p>
          </div>
        ) : (
          <div
            className="desk-log-body"
            ref={bodyRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
          >
            {view === 'chat' && hasTranscript ? (
              <div className="desk-transcript">
                {transcriptEntries.map((entry, index) => {
                  const thinking = entry.kind === 'reasoning' || entry.kind === 'thinking';
                  const tool = entry.kind === 'tool';
                  return (
                    <article
                      className={`desk-transcript-entry ${
                        entry.role === 'user'
                          ? 'user'
                          : thinking
                            ? 'thinking'
                            : tool
                              ? 'tool'
                              : 'assistant'
                      }`}
                      key={`${entry.kind}-${entry.role || 'entry'}-${index}`}
                    >
                      <span>
                        {entry.role === 'user' ? 'YOU' : thinking ? 'THINKING' : tool ? 'TOOL' : 'AGENT'}
                      </span>
                      <TranscriptMarkdown text={entry.text || ''} />
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="desk-terminal-lines">
                {displayBlocks.length ? (
                  displayBlocks.map((block, blockIndex) => (
                    <div
                      className={`desk-term-block ${block.kind}`}
                      key={`${blockIndex}-${block.kind}-${block.lines[0]?.slice(0, 18)}`}
                    >
                      {block.kind !== 'text' && block.kind !== 'stamp' && (
                        <div className="desk-term-block-label">
                          {block.kind === 'thinking' ? 'THINKING' : 'TOOL'}
                        </div>
                      )}
                      {block.lines.map((line, index) => (
                        <div
                          className={`desk-term-line ${block.kind}`}
                          key={`${index}-${line.slice(0, 18)}`}
                        >
                          {line || '\u00a0'}
                        </div>
                      ))}
                    </div>
                  ))
                ) : null}
              </div>
            )}
          </div>
        )}

        {isFreebuff && (
          <form className="desk-log-compose" onSubmit={sendReply}>
            <div className="composer">
              <input
                ref={fileInputRef}
                type="file"
                className="desk-file-input"
                onChange={(event) => void attachFile(event)}
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                className="plus-btn"
                title="파일 첨부 (서버가 저장하고 경로를 전송)"
                aria-label="파일 첨부"
                disabled={attaching || sending}
                onClick={() => fileInputRef.current?.click()}
              >
                {attaching ? <Loader2 size={17} className="spin" /> : <Plus size={19} />}
              </button>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder="Freebuff에 메시지를 입력하세요"
                rows={1}
                aria-label="Freebuff에 메시지 입력"
              />
              <button
                type="submit"
                className={`send-btn ${reply.trim() || attachment ? 'ready' : ''}`}
                disabled={(!reply.trim() && !attachment) || sending || (!agent.terminalHandle && !agent.id)}
                aria-label={sent ? '전달됨' : '보내기'}
              >
                {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            {attachment && (
              <div className="desk-log-attachment">
                <FileText size={13} />
                <div>
                  <strong>{attachment.name}</strong>
                  <code>{attachment.path}</code>
                </div>
                <span>{Math.max(1, Math.round(attachment.size / 1024)).toLocaleString('ko-KR')}KB</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="첨부 제거"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="desk-log-compose-tools">
              <div className="desk-log-compose-hint">
                <ShieldCheck size={11} />
                {sent ? '전달됨' : '현재 터미널로 직접 전달'} · /model 같은 네이티브 명령 그대로 · Shift+Enter 줄바꿈
              </div>
              <button type="button" onClick={() => void attachUrl()} disabled={attaching || sending}>
                URL에서 파일 받기
              </button>
            </div>
            {lastSent && (
              <div className="desk-log-sent" title={lastSent}>
                <Check size={11} /> 전달됨 · 경로 포함 · 응답 대기 중
              </div>
            )}
            {sendError && (
              <div className="desk-log-compose-error">
                <AlertTriangle size={11} />
                {sendError}
              </div>
            )}
          </form>
        )}

        {isShell && (
          <form className="desk-log-compose" onSubmit={sendReply}>
            <div className="composer">
              <span className="desk-shell-prompt">$</span>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder="이 워크트리에서 실행할 셸 명령"
                rows={1}
                aria-label="워크트리 셸 명령 입력"
              />
              <button
                type="submit"
                className={`send-btn ${reply.trim() ? 'ready' : ''}`}
                disabled={!reply.trim() || sending || !agent.terminalHandle}
                aria-label={sent ? '실행됨' : '명령 실행'}
              >
                {sending ? <Loader2 size={15} className="spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
            <div className="desk-log-compose-hint">
              <ShieldCheck size={11} />
              {sent ? '명령을 보냈어요' : '현재 워크트리 셸'} · Enter 실행 · Shift+Enter 줄바꿈
            </div>
            {lastSent && (
              <div className="desk-log-sent" title={lastSent}>
                <Check size={11} /> 실행됨 · {lastSent.slice(0, 80)}
              </div>
            )}
            {sendError && (
              <div className="desk-log-compose-error">
                <AlertTriangle size={11} />
                {sendError}
              </div>
            )}
          </form>
        )}

        <div className="desk-log-foot">
          <span>
            <Zap size={12} />
            {snapshot?.fetchedAt
              ? `${new Date(snapshot.fetchedAt).toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })} 갱신`
              : '실시간'}
          </span>
          <span>
            <Terminal size={12} />
            {view === 'chat' && hasTranscript
              ? `${transcriptEntries.length} messages`
              : `${snapshot?.returnedLineCount ?? 0} lines`}
          </span>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function CreditsDrawer({
  overview,
  onClose,
}: {
  overview: OrcaOverview | null;
  onClose: () => void;
}) {
  const { quota, loading: agyLoading, refresh: refreshAgy } = useAgyQuota(true);
  const [freebuff, setFreebuff] = useState<FreebuffUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const next = await orcaApi.usage(refresh);
      setFreebuff(next);
      setError(next.ok ? null : next.error || 'Freebuff 사용량을 불러오지 못했어요.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Freebuff 사용량을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    refreshAgy();
    void load(true);
  };

  return createPortal(
    <div className="desk-drawer-layer">
      <div className="desk-drawer-backdrop" onClick={onClose} />
      <aside className="desk-credit-panel" role="dialog" aria-modal="true" aria-label="크레딧과 런타임">
        <div className="desk-drawer-head">
          <div>
            <span className="desk-kicker">
              <Sparkles size={12} /> CREDIT TREE
            </span>
            <h2>크레딧 · 런타임</h2>
            <p>Orca 호스트와 연결된 실제 계정의 상태만 표시합니다.</p>
          </div>
          <button className="desk-icon" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="desk-credit-scroll">
          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon freebuff">
                <Zap size={15} />
              </span>
              <div>
                <strong>Freebuff</strong>
                <span>
                  {freebuff?.configured ? 'CLI 계정 연결됨' : 'CLI 로그인 필요'}
                </span>
              </div>
              <span className={`desk-credit-pill ${freebuff?.ok ? 'ok' : 'warn'}`}>
                {freebuff?.ok ? freebuff.plan || 'free' : '확인 불가'}
              </span>
            </div>
            <div className="desk-credit-branch">
              <div className="desk-credit-row">
                <span>API 크레딧</span>
                <strong>
                  {freebuff?.apiCredits
                    ? freebuff.apiCredits.remaining.toLocaleString('ko-KR')
                    : '—'}
                </strong>
              </div>
              <div className="desk-credit-row">
                <span>이번 달 사용</span>
                <strong>
                  {freebuff?.apiCredits
                    ? freebuff.apiCredits.usage.toLocaleString('ko-KR')
                    : '—'}
                </strong>
              </div>
              <div className="desk-credit-row">
                <span>다음 리셋까지</span>
                <strong>
                  {remainingUntilLabel(freebuff?.apiCredits?.nextResetAt) || '—'}
                </strong>
              </div>
              <div className="desk-credit-row muted">
                <span>컨텍스트 · 추론</span>
                <strong>세션 종료 시 터미널 표시</strong>
              </div>
              <div className="desk-freebuff-model-list">
                <div className="desk-freebuff-model-list-head">
                  <span>모델</span>
                  <span>1시간 세션</span>
                  <span>effort</span>
                </div>
                {FREEBUFF_MODELS.map((freebuffModel) => (
                  <div className="desk-freebuff-model-list-row" key={freebuffModel.id}>
                    <strong>{freebuffModel.label}</strong>
                    <span>{freebuffModel.hours}시간</span>
                    <span>{freebuffModel.effort}</span>
                  </div>
                ))}
                <p>/model은 Freebuff 네이티브 명령입니다.</p>
              </div>
              {freebuff?.note && <p className="desk-credit-note">{freebuff.note}</p>}
              {error && <p className="desk-credit-error">{error}</p>}
              <button className="desk-credit-refresh" onClick={() => void load(true)} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                Freebuff 다시 읽기
              </button>
            </div>
          </section>

          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon agy">
                <Sparkles size={15} />
              </span>
              <div>
                <strong>Agy</strong>
                <span>Agy CLI /usage · 실제 구독 한도</span>
              </div>
              <span className="desk-credit-pill ok">{agyLoading ? '…' : 'live'}</span>
            </div>
            <div className="desk-credit-branch">
              {quota?.groups.length ? (
                quota.groups.map((group) => (
                  <div className="desk-credit-group" key={group.name}>
                    <div className="desk-credit-group-name">{group.name}</div>
                    {group.buckets.map((bucket) => (
                      <div className="desk-credit-bucket" key={`${group.name}-${bucket.id}-${bucket.window}`}>
                        <div>
                          <span>{bucket.window === '5h' ? '5시간' : bucket.window === 'weekly' ? '주간' : bucket.name}</span>
                          <strong>
                            {bucket.disabled
                              ? '미적용'
                              : bucket.remaining === null
                                ? '측정 없음'
                                : `${bucket.remaining}%`}
                          </strong>
                        </div>
                        <div className="desk-credit-bar">
                          <span style={{ width: `${bucket.remaining ?? 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <p className="desk-credit-note">
                  {quota?.error || (agyLoading ? 'Agy 한도를 불러오는 중…' : '표시할 Agy 한도가 없어요.')}
                </p>
              )}
              <button className="desk-credit-refresh" onClick={refreshAgy} disabled={agyLoading}>
                <RefreshCw size={12} className={agyLoading ? 'spin' : ''} />
                Agy 다시 읽기
              </button>
            </div>
          </section>

          <section className="desk-credit-node">
            <div className="desk-credit-root">
              <span className="desk-credit-icon orca">
                <Boxes size={15} />
              </span>
              <div>
                <strong>Orca runtime</strong>
                <span>{overview?.host || 'local'} · worktree fleet</span>
              </div>
            </div>
            <div className="desk-credit-branch">
              <div className="desk-credit-row">
                <span>워크트리</span>
                <strong>{overview?.counts.worktrees ?? 0}</strong>
              </div>
              <div className="desk-credit-row">
                <span>등록된 에이전트</span>
                <strong>{overview?.counts.agents ?? 0}</strong>
              </div>
              <div className="desk-credit-row">
                <span>작업 중</span>
                <strong className="hot">{overview?.counts.working ?? 0}</strong>
              </div>
            </div>
          </section>
        </div>

        <div className="desk-drawer-foot">
          <button className="desk-btn ghost" onClick={refresh}>
            <RefreshCw size={13} /> 전체 새로고침
          </button>
          <span>값은 서버에서만 읽고 브라우저로 자격 증명을 보내지 않습니다.</span>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function AddProjectDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (overview: OrcaOverview, path: string) => void;
}) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await orcaApi.addProject(path.trim());
      const worktree = result.overview.worktrees.find(
        (item) => item.path === result.path || item.path.startsWith(result.path),
      );
      onAdded(result.overview, worktree?.path || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '프로젝트를 추가하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="desk-modal-layer">
      <div className="desk-modal-backdrop" onClick={onClose} />
      <form className="desk-modal" onSubmit={submit}>
        <div className="desk-modal-head">
          <div>
            <span className="desk-kicker">
              <FolderPlus size={12} /> ADD PROJECT
            </span>
            <h2>프로젝트 추가</h2>
            <p>이미 있는 폴더나 Git 저장소를 Orca에 등록합니다.</p>
          </div>
          <button type="button" className="desk-icon" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <label className="desk-field">
          <span>절대 경로</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/home/ubuntu/my-project"
            autoFocus
            spellCheck={false}
          />
        </label>
        <div className="desk-modal-hint">
          <GitBranch size={13} />
          .git이 있으면 Git 프로젝트로, 없으면 일반 폴더로 등록합니다.
        </div>
        {error && (
          <div className="desk-banner">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
        <div className="desk-modal-actions">
          <button type="button" className="desk-btn ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="desk-btn" disabled={!path.trim() || busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            추가
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
