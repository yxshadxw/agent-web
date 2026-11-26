import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import anime from 'animejs';
import { Check, Loader2, Lock, RefreshCw, User, WifiOff, X } from 'lucide-react';
import { AmbientBackdrop } from './components/AmbientBackdrop';
import { Header } from './components/Header';
import { Timeline } from './components/Timeline';
import { Composer, type Attachment } from './components/Composer';
import type { BackgroundRunItem } from './components/BackgroundRunChips';
import { AutoList, ContextSheet, ModelList, ReasonList, UsageSheet, type UnifiedModelGroup } from './components/Sheets';
import type { TeamTreeAgent } from './components/InfoPanel';
import { deriveTodosFromTools } from './components/TodoBar';
import type { CodexPanelState } from './components/CodexPanel';
import { Sidebar } from './components/Sidebar';
import { AndroidModal } from './components/AndroidModal';

const InfoPanel = lazy(() =>
  import('./components/InfoPanel').then((m) => ({ default: m.InfoPanel })),
);
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);
const ParallelDesk = lazy(() =>
  import('./components/ParallelDesk').then((m) => ({ default: m.ParallelDesk })),
);
const CodexPanel = lazy(() =>
  import('./components/CodexPanel').then((m) => ({ default: m.CodexPanel })),
);
import { BrandGlyph } from './components/Brand';
import { useAgent } from './hooks/useAgent';
import { useAgyQuota } from './hooks/useQuota';
import { engineLabel, getEngine, switchEngine } from './lib/engine';
import { smoothScrollToBottom, cancelSmoothScroll } from './lib/smoothScroll';
import { orcaApi, type WorktreeDiffPayload } from './lib/orca';
import { useAppSettings } from './lib/preferences';
import {
  api,
  contextTokens,
  findModel,
  lastUserMessage,
  sessionCost,
  sessionTokens,
} from './lib/api';
import type { AgentProvider, AgentSession } from './lib/api';
import {
  baseName,
  shortPath,
  type ComposerPanel,
  type InfoTab,
  type PinnedFile,
} from './data';

const PIN_KEY = (sessionID: string) => `agent-web:pins:${sessionID}`;
const DESK_OPEN_KEY = 'agent-web:desk-open:v1';
const CODEX_TITLE_KEY = 'agent-web:codex-title:v1';

function loadCodexTitle(): string {
  try {
    return localStorage.getItem(CODEX_TITLE_KEY) || '';
  } catch {
    return '';
  }
}

function loadDeskOpen(): boolean {
  try {
    return localStorage.getItem(DESK_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function loadPins(sessionID: string | null): PinnedFile[] {
  if (!sessionID) return [];
  try {
    const raw = localStorage.getItem(PIN_KEY(sessionID));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PinnedFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePins(sessionID: string | null, pins: PinnedFile[]) {
  if (!sessionID) return;
  localStorage.setItem(PIN_KEY(sessionID), JSON.stringify(pins));
}

export default function App() {
  const agent = useAgent();
  const prefs = useAppSettings();
  const engine = getEngine();
  const codexMode = engine === 'codex';
  const quotaState = useAgyQuota(agent.auth === 'ok');
  const [panel, setPanel] = useState<ComposerPanel>(null);
  const [deskOpen, setDeskOpen] = useState(loadDeskOpen);
  const [codexOpen, setCodexOpen] = useState(false);
  const [codexStatsOpen, setCodexStatsOpen] = useState(false);
  const [codexResetKey, setCodexResetKey] = useState(0);
  const [codexTitle, setCodexTitle] = useState(loadCodexTitle);
  const [codexState, setCodexState] = useState<CodexPanelState | null>(null);
  const [teamAgents, setTeamAgents] = useState<TeamTreeAgent[]>([]);
  const [worktreeDiff, setWorktreeDiff] = useState<WorktreeDiffPayload | null>(null);
  const codexScreen = codexMode || codexOpen;
  const pinScope = codexScreen ? 'codex-chat' : agent.sessionID;
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>('info');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pins, setPins] = useState<PinnedFile[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [tick, setTick] = useState(0);
  const [otherProviders, setOtherProviders] = useState<AgentProvider[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [dismissedRuns, setDismissedRuns] = useState<Set<string>>(() => new Set());

  const chatRuns = useMemo<BackgroundRunItem[]>(() => {
    const items: BackgroundRunItem[] = [];
    const lastUserIdx = agent.messages.reduce(
      (last, m, idx) => (m.info.role === 'user' ? idx : last),
      -1,
    );
    const turnMsgs = lastUserIdx >= 0 ? agent.messages.slice(lastUserIdx + 1) : agent.messages;
    for (const msg of turnMsgs) {
      for (const part of msg.parts) {
        if (part.type !== 'tool') continue;
        if (!/bash|shell|exec|bg_run|task|agent|subagent|command/i.test(part.tool)) continue;
        if (dismissedRuns.has(part.id)) continue;
        const st = part.state.status;
        const inp = (part.state.input || {}) as Record<string, unknown>;
        const label =
          (typeof inp.description === 'string' && inp.description) ||
          (typeof inp.command === 'string' && inp.command.split('\n')[0]) ||
          (typeof inp.CommandLine === 'string' && inp.CommandLine.split('\n')[0]) ||
          part.tool;
        const status: BackgroundRunItem['status'] =
          st === 'running' || st === 'pending'
            ? 'running'
            : st === 'error'
              ? 'stopped'
              : 'done';
        const output =
          st === 'completed'
            ? part.state.output
            : st === 'error'
              ? part.state.error
              : undefined;
        items.push({
          id: part.id,
          label: label.slice(0, 36),
          detail: typeof inp.command === 'string' ? inp.command : typeof inp.CommandLine === 'string' ? inp.CommandLine : undefined,
          output: output ? output.slice(0, 4000) : undefined,
          status,
        });
      }
    }
    return items.slice(-4);
  }, [agent.messages, dismissedRuns]);

  useEffect(() => {
    if (agent.auth !== 'ok' || codexMode) return;
    let alive = true;
    const otherUrl = engine === 'agy' ? '/api/config/providers' : '/agy-api/config/providers';
    fetch(otherUrl, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.providers) ? data.providers : [];
        setOtherProviders(list);
      })
      .catch(() => {
        if (alive) setOtherProviders([]);
      });
    return () => {
      alive = false;
    };
  }, [agent.auth, codexMode, engine, panel]);

  const unifiedModelGroups = useMemo<UnifiedModelGroup[]>(() => {
    const groups: UnifiedModelGroup[] = [];
    const currentList = agent.providers?.providers || [];
    const agyList = engine === 'agy' ? currentList : otherProviders;
    const ocList = engine === 'opencode' ? currentList : otherProviders;

    const toItems = (list: AgentProvider[]) =>
      list.flatMap((provider) =>
        Object.values(provider.models || {}).map((model) => ({
          providerID: provider.id,
          modelID: model.id,
          name: model.name || model.id,
          sub: model.id,
        })),
      );

    const agyItems = toItems(agyList);
    if (agyItems.length) {
      groups.push({ id: 'agy', label: 'Agy (Antigravity)', engine: 'agy', items: agyItems });
    }
    const ocItems = toItems(ocList);
    if (ocItems.length) {
      groups.push({ id: 'opencode', label: 'OpenCode', engine: 'opencode', items: ocItems });
    }
    groups.push({
      id: 'codex',
      label: 'Codex',
      engine: 'codex',
      items: [
        { providerID: 'codex', modelID: 'gpt-6-luna', name: 'GPT-6 Luna', sub: 'Codex CLI' },
        { providerID: 'codex', modelID: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', sub: 'Codex CLI' },
        { providerID: 'codex', modelID: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', sub: 'Codex CLI' },
      ],
    });
    groups.push({
      id: 'claude',
      label: 'Claude Code',
      engine: 'codex',
      items: [
        { providerID: 'claude', modelID: 'claude:claude-opus-4-6', name: 'Claude Opus 4.6', sub: 'Claude CLI' },
        { providerID: 'claude', modelID: 'claude:claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sub: 'Claude CLI' },
        { providerID: 'claude', modelID: 'claude:claude-haiku-4-5', name: 'Claude Haiku 4.5', sub: 'Claude CLI' },
      ],
    });
    return groups;
  }, [agent.providers, engine, otherProviders]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const stick = useRef(true);
  const wasBusy = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const refreshModels = useCallback(async () => {
    if (refreshingModels) return;
    setRefreshingModels(true);
    try {
      const otherUrl = engine === 'agy' ? '/api/config/providers?refresh=1' : '/agy-api/config/providers?refresh=1';
      const [, otherData] = await Promise.all([
        agent.refreshProviders().catch(() => null),
        fetch(otherUrl, { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ]);
      if (Array.isArray(otherData?.providers)) {
        setOtherProviders(otherData.providers);
      }
      showToast('모델 목록을 새로고침했어요');
    } finally {
      setRefreshingModels(false);
    }
  }, [agent, engine, refreshingModels, showToast]);

  useEffect(() => {
    setPins(loadPins(pinScope));
  }, [pinScope]);

  useEffect(() => {
    if (!infoOpen) return;
    let alive = true;
    const workDir = agent.session?.directory || agent.pathInfo?.worktree || '';
    void orcaApi
      .overview(false)
      .then((overview) => {
        if (!alive) return;
        const agentsList = (overview.agents || [])
          .filter((item) => !workDir || item.path === workDir || item.repo === baseName(workDir))
          .slice(0, 12)
          .map((item) => ({
            id: item.id,
            name: item.title || item.agent,
            model: `${item.agent} CLI`,
            role: item.role ?? null,
            agent: item.agent,
            state: item.state,
            onSelect: () => {
              setInfoOpen(false);
              setDeskOpen(true);
            },
          }));
        setTeamAgents(agentsList);
      })
      .catch(() => undefined);
    if (workDir) {
      void orcaApi
        .worktreeDiff(workDir)
        .then((res) => {
          if (alive && res.ok) setWorktreeDiff(res);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [agent.pathInfo?.worktree, agent.session?.directory, codexScreen, infoOpen]);

  useEffect(() => {
    if (!agent.busy) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [agent.busy]);

  useEffect(() => {
    try {
      localStorage.setItem(DESK_OPEN_KEY, deskOpen ? '1' : '0');
      sessionStorage.removeItem(DESK_OPEN_KEY);
    } catch {
      // Storage can be unavailable in embedded browsers.
    }
  }, [deskOpen]);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    const finished = wasBusy.current && !agent.busy;
    wasBusy.current = agent.busy;
    if (!finished || !prefs.notifications) return;
    if (document.visibilityState !== 'hidden') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification('작업이 끝났어요', {
        body: agent.session?.title || '에이전트 응답이 도착했습니다.',
        tag: 'agent-web-turn-finished',
      });
    } catch {
      // browsers can reject notifications even after permission was granted
    }
  }, [agent.busy, agent.session?.title, prefs.notifications]);

  useEffect(() => {
    if (agent.auth !== 'ok') return;
    const timer = window.setTimeout(() => {
      anime({
        targets: '.turn',
        opacity: [0, 1],
        translateY: [8, 0],
        delay: anime.stagger(28, { start: 30 }),
        duration: 300,
        easing: 'easeOutQuad',
      });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [agent.sessionID, agent.auth]);

  useEffect(() => {
    stick.current = true;
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      smoothScrollToBottom(el, { instant: true });
    });
  }, [agent.sessionID]);

  const signature = useMemo(
    () =>
      agent.messages
        .map((message) => {
          const parts = message.parts
            .map((part) =>
              part.type === 'text'
                ? `${part.id}:${part.text.length}`
                : part.type === 'reasoning'
                  ? `${part.id}:${part.text.length}`
                  : part.id,
            )
            .join(',');
          return `${message.info.id}/${parts}`;
        })
        .join('|'),
    [agent.messages],
  );

  useEffect(() => {
    if (!stick.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    smoothScrollToBottom(el, { shouldContinue: () => stick.current });
  }, [signature, agent.busy, agent.permissions.length, agent.error]);

  const session = agent.session;
  const parentSession =
    session?.parentID
      ? agent.sessions.find((item) => item.id === session.parentID) ?? null
      : null;
  const selectedModel = agent.selectedModel;
  const modelName = selectedModel?.name || agent.model.modelID || '모델 선택';
  const providerName =
    agent.providers?.providers.find((provider) => provider.id === agent.model.providerID)?.name ||
    engineLabel(engine);
  const contextLimit = selectedModel?.limit.context || 200_000;
  const used = contextTokens(agent.messages);
  const remainingPct = useMemo(() => {
    const limits = (quotaState.quota?.groups || [])
      .flatMap((group) => group.buckets)
      .filter((bucket) => !bucket.disabled && typeof bucket.remaining === 'number')
      .map((bucket) => bucket.remaining as number);
    if (limits.length > 0) return Math.max(0, Math.min(100, Math.min(...limits)));
    return Math.max(0, Math.min(100, 100 - (contextLimit > 0 ? (used / contextLimit) * 100 : 0)));
  }, [quotaState.quota, used, contextLimit]);
  const remainingLabel = useMemo(() => {
    const candidates = (quotaState.quota?.groups || [])
      .flatMap((group) => group.buckets)
      .filter((bucket) => !bucket.disabled && typeof bucket.remaining === 'number');
    if (!candidates.length) return null;
    const limiting = candidates.reduce((left, right) =>
      (left.remaining ?? 101) <= (right.remaining ?? 101) ? left : right,
    );
    return `${Math.round(limiting.remaining as number)}%`;
  }, [quotaState.quota]);
  const usageTokens = sessionTokens(agent.messages, session);
  const usageCost = sessionCost(agent.messages, session);
  const variants = Object.entries(selectedModel?.variants ?? {})
    .filter(([, value]) => !value || !value.disabled)
    .map(([key]) => key);
  const hasVariants = variants.length > 0;

  const userMessage = lastUserMessage(agent.messages);
  const lastAssistant = [...agent.messages]
    .reverse()
    .find((message) => message.info.role === 'assistant');
  const elapsed = useMemo(() => {
    if (!userMessage) return 0;
    const start = userMessage.time.created;
    const end = agent.busy
      ? Date.now()
      : lastAssistant?.info.role === 'assistant'
        ? lastAssistant.info.time.completed || lastAssistant.info.time.created
        : Date.now();
    return Math.max(0, (end - start) / 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessage, agent.busy, lastAssistant, tick]);

  const openInfo = useCallback((tab?: InfoTab) => {
    if (tab) setInfoTab(tab);
    setInfoOpen(true);
  }, []);

  const openSettings = useCallback(() => {
    setSidebarOpen(false);
    setInfoOpen(false);
    setPanel(null);
    setSettingsOpen(true);
  }, []);

  const openDesk = useCallback(() => {
    setSidebarOpen(false);
    setInfoOpen(false);
    setPanel(null);
    setSettingsOpen(false);
    setDeskOpen(true);
  }, []);

  const selectSession = useCallback(
    async (id: string) => {
      setSidebarOpen(false);
      setSettingsOpen(false);
      setPanel(null);
      try {
        await agent.selectSession(id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : '세션을 열지 못했어요');
      }
    },
    [agent, showToast],
  );

  const newSession = useCallback(async () => {
    setSidebarOpen(false);
    setSettingsOpen(false);
    setPanel(null);
    if (codexScreen) {
      setCodexTitle('');
      try {
        localStorage.removeItem(CODEX_TITLE_KEY);
      } catch {
        // ignore
      }
      setCodexResetKey((value) => value + 1);
      showToast('새 세션을 시작했어요');
      return;
    }
    setCodexResetKey((value) => value + 1);
    try {
      await agent.createSession();
      setDraft('');
      showToast('새 세션을 시작했어요');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '세션을 만들지 못했어요');
    }
  }, [agent, codexScreen, showToast]);

  const deleteSession = useCallback(
    async (target: AgentSession | null) => {
      if (codexScreen) {
        if (!window.confirm('현재 Codex 대화 기록을 비울까요?')) return;
        setCodexTitle('');
        try {
          localStorage.removeItem(CODEX_TITLE_KEY);
        } catch {
          // ignore
        }
        setCodexResetKey((value) => value + 1);
        setInfoOpen(false);
        showToast('대화를 비웠어요');
        return;
      }
      if (!target) return;
      const agy = getEngine() === 'agy';
      const question = agy
        ? `"${target.title}" 세션을 목록에서 숨길까요? Agy 기록은 유지됩니다.`
        : `"${target.title}" 세션을 삭제할까요?`;
      if (!window.confirm(question)) return;
      try {
        await agent.deleteSession(target.id);
        setPanel(null);
        setInfoOpen(false);
        showToast(agy ? '세션을 목록에서 숨겼어요' : '세션을 삭제했어요');
      } catch (err) {
        showToast(err instanceof Error ? err.message : '세션을 삭제하지 못했어요');
      }
    },
    [agent, codexScreen, showToast],
  );

  const renameSession = useCallback(async () => {
    if (codexScreen) {
      const current = codexTitle || 'Codex 채팅';
      const title = window.prompt('새 세션 타이틀', current);
      if (!title || !title.trim() || title.trim() === current) return;
      const clean = title.trim();
      setCodexTitle(clean);
      try {
        localStorage.setItem(CODEX_TITLE_KEY, clean);
      } catch {
        // ignore
      }
      showToast('타이틀을 변경했어요');
      return;
    }
    if (!session) return;
    const title = window.prompt('새 세션 타이틀', session.title);
    if (!title || !title.trim() || title.trim() === session.title) return;
    try {
      await agent.renameSession(session.id, title.trim());
      showToast(
        getEngine() === 'agy' ? '표시 이름을 변경했어요' : '타이틀을 변경했어요',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '타이틀을 변경하지 못했어요');
    }
  }, [agent, codexScreen, codexTitle, session, showToast]);

  const copyId = useCallback(async () => {
    const id = codexScreen ? codexState?.threadId : session?.id;
    if (!id) {
      showToast(codexScreen ? '먼저 메시지를 보내면 스레드 ID가 생성돼요' : '복사할 세션 ID가 없어요');
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      showToast('세션 ID를 복사했어요');
    } catch {
      showToast('복사할 수 없어요');
    }
  }, [codexScreen, codexState?.threadId, session, showToast]);

  const handleSend = useCallback(
    (text: string, files: Attachment[]) => {
      void agent.send(
        text,
        files.map((file) => ({
          mime: file.mime,
          filename: file.filename,
          url: file.url,
        })),
      );
    },
    [agent],
  );

  const retry = useCallback(() => {
    if (!userMessage) return;
    const text = agent.messages
      .filter((message) => message.info.id === userMessage.id)
      .flatMap((message) =>
        message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
      )
      .join('\n\n');
    if (!text) return;
    void agent.send(text);
  }, [agent, userMessage]);

  const fork = useCallback(
    async (messageID: string) => {
      if (!session) return;
      try {
        await agent.forkSession(session.id, messageID);
        showToast('이 지점에서 새 세션으로 분기했어요');
      } catch (err) {
        showToast(err instanceof Error ? err.message : '분기하지 못했어요');
      }
    },
    [agent, session, showToast],
  );

  const togglePin = useCallback(
    (file: PinnedFile) => {
      if (!pinScope) {
        showToast('세션을 먼저 열어주세요');
        return;
      }
      setPins((current) => {
        const exists = current.some((pin) => pin.path === file.path);
        const next = exists
          ? current.filter((pin) => pin.path !== file.path)
          : [...current, file];
        savePins(pinScope, next);
        showToast(exists ? '핀을 해제했어요' : '파일을 핀했어요');
        return next;
      });
    },
    [pinScope, showToast],
  );

  const pickModel = useCallback(
    (providerID: string, modelID: string) => {
      agent.selectModel(providerID, modelID);
      const picked = findModel(agent.providers?.providers ?? null, providerID, modelID);
      showToast(`${picked?.name || modelID} 모델로 전환했어요`);
    },
    [agent, showToast],
  );

  const compressContext = useCallback(async () => {
    if (!agent.sessionID || !agent.model.providerID) return;
    setCompressing(true);
    try {
      await api.summarize(agent.sessionID, agent.model.providerID, agent.model.modelID);
      setPanel(null);
      showToast('컨텍스트 압축을 시작했어요');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '압축하지 못했어요');
    } finally {
      setCompressing(false);
    }
  }, [agent, showToast]);

  const logout = useCallback(async () => {
    if (!window.confirm('접속을 해제할까요? 아이디와 비밀번호를 다시 입력해야 합니다.')) return;
    await agent.logout();
    setPanel(null);
    setSidebarOpen(false);
    setInfoOpen(false);
    setSettingsOpen(false);
  }, [agent]);

  const [infoLoaded, setInfoLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    if (infoOpen) setInfoLoaded(true);
  }, [infoOpen]);
  useEffect(() => {
    if (settingsOpen) setSettingsLoaded(true);
  }, [settingsOpen]);

  const derivedTodos = useMemo(() => {
    if (agent.todos.length > 0) return agent.todos;
    let lastUserIdx = -1;
    for (let i = agent.messages.length - 1; i >= 0; i -= 1) {
      if (agent.messages[i].info.role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const turnMessages =
      lastUserIdx >= 0 ? agent.messages.slice(lastUserIdx + 1) : agent.messages;
    return deriveTodosFromTools(
      turnMessages.flatMap((m) =>
        m.info.role === 'assistant'
          ? m.parts.flatMap((p) => {
              if (p.type !== 'tool') return [];
              const inp = (p.state.input || {}) as Record<string, unknown>;
              const structuredTodo =
                /todo/i.test(p.tool) && Array.isArray(inp.todos)
                  ? JSON.stringify(inp)
                  : '';
              const detail =
                structuredTodo ||
                (typeof inp.command === 'string' && inp.command) ||
                (typeof inp.filePath === 'string' && inp.filePath) ||
                (typeof inp.path === 'string' && inp.path) ||
                (typeof inp.query === 'string' && inp.query) ||
                p.tool;
              return [
                {
                  id: p.id,
                  tool: p.tool,
                  detail,
                  status: p.state.status,
                },
              ];
            })
          : [],
      ),
      turnMessages.flatMap((m) =>
        m.info.role === 'assistant'
          ? m.parts.flatMap((p) =>
              p.type === 'text' || p.type === 'reasoning' ? [p.text] : [],
            )
          : [],
      ),
      agent.busy,
    );
  }, [agent.todos, agent.messages, agent.busy]);

  if (agent.auth === 'checking') {
    return (
      <div className="stage">
        <AmbientBackdrop className="is-login" />
        <div className="phone login-phone">
          <div className="login-screen">
            <div className="login-mark">
              <BrandGlyph />
            </div>
            <h1>에이전트에 연결하는 중</h1>
            <p>로컬 {engineLabel(engine)} 서버와 세션을 불러오고 있어요.</p>
            <div className="login-loading">
              <Loader2 size={17} className="spin" />
              연결 확인 중…
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (agent.auth === 'required') {
    return <LoginScreen onLogin={agent.login} />;
  }

  if (agent.auth === 'error') {
    return (
      <div className="stage">
        <AmbientBackdrop className="is-login" />
        <div className="phone login-phone">
          <div className="login-screen">
            <div className="login-mark">
              <BrandGlyph />
            </div>
            <h1>서버에 연결할 수 없어요</h1>
            <p>
              {agent.error ||
                `${engineLabel(engine)} 서버가 실행 중인지 확인해 주세요.`}
            </p>
            <button className="login-btn" onClick={() => void agent.retry()}>
              <RefreshCw size={16} />
              다시 연결
            </button>
            {engine === 'agy' && (
              <button className="login-btn secondary" onClick={() => switchEngine('opencode')}>
                OpenCode로 전환
              </button>
            )}
            <div className="login-hint">
              터미널에서 <code>npm run dev</code>를 실행하면 Agy 브리지와 OpenCode 서버가
              함께 시작됩니다. Agy는 <code>agy</code> 로그인을 그대로 사용합니다.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (deskOpen) {
    return (
      <Suspense
        fallback={
          <div className="stage">
            <AmbientBackdrop className="is-login" />
            <div className="phone login-phone">
              <div className="login-screen">
                <div className="login-loading">
                  <Loader2 size={17} className="spin" />
                  병렬 데스크 불러오는 중…
                </div>
              </div>
            </div>
          </div>
        }
      >
        <ParallelDesk onClose={() => setDeskOpen(false)} />
      </Suspense>
    );
  }

  const composerPanel =
    panel === 'auto' ? (
      <AutoList
        value={agent.autoApprove}
        onPick={(auto) => {
          agent.setAutoApprove(auto);
          setPanel(null);
          showToast(auto ? '권한 요청을 자동으로 허용해요' : '권한 요청을 직접 확인해요');
        }}
      />
    ) : panel === 'model' ? (
      <ModelList
        providers={agent.providers?.providers || []}
        providerID={agent.model.providerID}
        modelID={agent.model.modelID}
        currentEngine={engine}
        groups={unifiedModelGroups}
        onRefresh={() => void refreshModels()}
        refreshing={refreshingModels}
        onPick={(providerID, modelID, targetEngine) => {
          if (targetEngine && targetEngine !== engine) {
            setPanel(null);
            switchEngine(
              targetEngine,
              targetEngine === 'codex' ? { codexModel: modelID } : { providerID, modelID },
            );
            return;
          }
          pickModel(providerID, modelID);
          setPanel(null);
        }}
      />
    ) : panel === 'reason' ? (
      <ReasonList
        options={variants}
        value={agent.model.variant}
        onPick={(variant) => {
          agent.selectVariant(variant);
          setPanel(null);
          showToast(`추론 강도: ${variant}`);
        }}
      />
    ) : panel === 'context' ? (
      <ContextSheet
        used={used}
        limit={contextLimit}
        tokens={usageTokens}
        modelName={modelName}
        compressing={compressing}
        onCompress={() => void compressContext()}
      />
    ) : panel === 'usage' ? (
      <UsageSheet
        session={session}
        tokens={usageTokens}
        cost={usageCost}
        messageCount={agent.messages.length}
        modelName={modelName}
        pinned={pins}
        quota={quotaState.quota}
        quotaLoading={quotaState.loading}
        onRefreshQuota={quotaState.refresh}
        onClose={() => setPanel(null)}
        onOpenInfo={() => {
          setPanel(null);
          setInfoTab('info');
          setInfoOpen(true);
        }}
      />
    ) : null;

  return (
    <div className="stage">
      <AmbientBackdrop className="is-chat" />
      <div className="phone">
        <Header
          session={session}
          titleOverride={codexScreen ? codexTitle || 'Codex 채팅' : undefined}
          canManageSession={codexScreen || Boolean(session)}
          pathInfo={agent.pathInfo}
          diffCount={codexScreen && worktreeDiff ? worktreeDiff.diffs.length : agent.diffs.length}
          onMenu={() => setSidebarOpen(true)}
          engineOverride={codexOpen && !codexMode ? 'codex' : undefined}
          onOpenInfo={(tab) => {
            openInfo(tab);
          }}
          onOpenPanel={(kind) => {
            if (codexScreen) {
              setCodexStatsOpen((current) => !current);
              return;
            }
            setPanel((current) => (current === kind ? null : kind));
          }}
          onNewSession={() => void newSession()}
          onSettings={openSettings}
          onOpenDesk={openDesk}
          onOpenAndroid={() => setAndroidOpen(true)}
          onCompact={!codexScreen ? () => void compressContext() : undefined}
          compacting={compressing}
          onOpenCodex={() => {
            if (codexMode) {
              switchEngine('agy');
              return;
            }
            setCodexOpen((value) => !value);
          }}
          onRename={() => void renameSession()}
          onDelete={() => void deleteSession(session)}
          onCopyId={() => void copyId()}
        />

        {codexScreen ? (
          <Suspense
            fallback={
              <main className="scroller">
                <div className="login-loading" style={{ margin: 'auto' }}>
                  <Loader2 size={17} className="spin" />
                  Codex 불러오는 중…
                </div>
              </main>
            }
          >
            <CodexPanel
              embedded
              onClose={codexMode ? undefined : () => setCodexOpen(false)}
              statsOpen={codexStatsOpen}
              onStatsOpen={setCodexStatsOpen}
              onOpenInfo={() => openInfo('info')}
              onStateChange={setCodexState}
              resetKey={codexResetKey}
            />
          </Suspense>
        ) : (
        <main
          className="scroller"
          ref={scrollerRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            stick.current = atBottom;
            if (!atBottom) cancelSmoothScroll(el);
          }}
        >
          <Timeline
            messages={agent.messages}
            busy={agent.busy}
            error={agent.error}
            onClearError={agent.clearError}
            onToast={showToast}
            onSuggestion={(text) => void agent.send(text)}
            onRetry={retry}
            onFork={(messageID) => void fork(messageID)}
            permissions={agent.permissions}
            onPermission={(permission, response) => void agent.replyPermission(permission, response)}
            onPin={togglePin}
            pinned={pins}
            expandThinking={prefs.expandThinking}
            canFork={engine !== 'agy'}
          />
        </main>
        )}

        {agent.connection === 'offline' && (
          <div className="conn-banner" role="status">
            <WifiOff size={14} />
            <span>에이전트 연결이 끊겼어요.</span>
            <button onClick={() => void agent.retry()}>다시 연결</button>
          </div>
        )}

        {!codexScreen && (
        <Composer
          key={agent.sessionID ?? 'new'}
          draft={draft}
          setDraft={setDraft}
          onSend={handleSend}
          onAbort={() => void agent.abort()}
          busy={agent.busy}
          disabled={agent.auth !== 'ok'}
          model={modelName}
          variant={agent.model.variant}
          hasVariants={hasVariants}
          elapsed={elapsed}
          todos={derivedTodos as any}
          todoStorageKey={session?.id || 'chat'}
          autoApprove={agent.autoApprove}
          panel={panel}
          onPanel={setPanel}
          panelContent={composerPanel}
          onToast={showToast}
          showContextRing={prefs.contextRing}
          remainingPct={remainingPct}
          remainingLabel={remainingLabel}
          onCompact={() => void compressContext()}
          compacting={compressing}
          compactDisabled={!agent.sessionID || agent.busy || compressing}
          runs={chatRuns}
          onDismissRun={(id) =>
            setDismissedRuns((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            })
          }
        />
        )}
      </div>

      {infoLoaded && (
        <Suspense fallback={null}>
          <InfoPanel
            open={infoOpen}
            tab={infoTab}
            onTab={setInfoTab}
            onClose={() => setInfoOpen(false)}
            session={
              codexScreen
                ? {
                    id: codexState?.threadId || 'codex-local',
                    title: codexTitle || 'Codex 채팅',
                    directory: agent.session?.directory || agent.pathInfo?.worktree || '',
                    agent: 'codex',
                    time: {
                      created: session?.time.created || Date.now(),
                      updated: Date.now(),
                    },
                    version: '1',
                    projectID: session?.projectID || 'codex',
                  }
                : session
            }
            parentSession={codexScreen ? null : parentSession}
            messages={codexScreen ? [] : agent.messages}
            diffs={
              codexScreen && worktreeDiff
                ? worktreeDiff.diffs
                : agent.diffs.length > 0
                  ? agent.diffs
                  : worktreeDiff?.diffs || []
            }
            children={codexScreen ? [] : agent.children}
            gitFiles={
              codexScreen && worktreeDiff
                ? worktreeDiff.files
                : agent.gitFiles.length > 0
                  ? agent.gitFiles
                  : worktreeDiff?.files || []
            }
            vcs={
              codexScreen && worktreeDiff?.branch
                ? { branch: worktreeDiff.branch, default_branch: agent.vcs?.default_branch }
                : agent.vcs
            }
            pathInfo={agent.pathInfo}
            providers={codexScreen ? 'OpenAI / Claude CLI' : providerName}
            modelName={codexScreen ? codexState?.modelLabel || 'GPT-6 Luna' : modelName}
            effort={codexScreen ? codexState?.effort : agent.model.variant}
            contextLimit={codexScreen ? codexState?.usage?.contextWindow || 272_000 : contextLimit}
            contextUsed={codexScreen ? codexState?.usage?.context || 0 : undefined}
            tokenOverride={
              codexScreen && codexState?.usage
                ? {
                    input: codexState.usage.input,
                    output: codexState.usage.output,
                    reasoning: codexState.usage.reasoning,
                    cache: { read: codexState.usage.cached, write: 0 },
                  }
                : undefined
            }
            activeEngine={codexScreen ? 'codex' : engine}
            codexQuota={codexState?.quota ?? undefined}
            teamAgents={teamAgents}
            quota={quotaState.quota}
            quotaLoading={quotaState.loading}
            onRefreshQuota={quotaState.refresh}
            pinned={pins}
            onTogglePin={togglePin}
            onOpenSession={(id) => void selectSession(id)}
            onToast={showToast}
          />
        </Suspense>
      )}

      <Sidebar
        open={sidebarOpen}
        sessions={agent.sessions}
        activeID={agent.sessionID}
        statuses={agent.statuses}
        pathInfo={agent.pathInfo}
        connection={agent.connection}
        onClose={() => setSidebarOpen(false)}
        onSelect={(id) => void selectSession(id)}
        onNewSession={() => void newSession()}
        onDelete={(target) => void deleteSession(target)}
        onSettings={openSettings}
        onLogout={() => void logout()}
        onToast={showToast}
      />

      {settingsLoaded && (
        <Suspense fallback={null}>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            modelName={modelName}
            connection={agent.connection}
            pinnedCount={pins.length}
            onOpenInfo={() => {
              setSettingsOpen(false);
              setInfoTab('pin');
              setInfoOpen(true);
            }}
            onOpenModel={() => {
              setSettingsOpen(false);
              setPanel('model');
            }}
            onLogout={() => void logout()}
          />
        </Suspense>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-check">
            <Check size={12} strokeWidth={3} />
          </span>
          {toast}
        </div>
      )}

      <AndroidModal open={androidOpen} onClose={() => setAndroidOpen(false)} />
    </div>
  );
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const engine = getEngine();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '접속하지 못했어요');
      setBusy(false);
    }
  };

  return (
    <div className="stage">
      <AmbientBackdrop className="is-login" />
      <div className="phone login-phone">
        <div className="login-screen">
          <div className="login-mark">
            <BrandGlyph />
          </div>
          <h1>에이전트 스튜디오</h1>
          <p>
            이 클라이언트는 로컬 {engineLabel(engine)} 서버에 연결됩니다. 아이디와
            비밀번호를 입력해 주세요.
          </p>
          <form className="login-form" onSubmit={submit}>
            <div className={`login-input ${error ? 'invalid' : ''}`}>
              <User size={16} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="아이디"
                autoFocus
                autoComplete="username"
                spellCheck={false}
              />
            </div>
            <div className={`login-input ${error ? 'invalid' : ''}`}>
              <Lock size={16} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="login-error">
                <X size={13} /> {error}
              </div>
            )}
            <button
              className="login-btn"
              type="submit"
              disabled={busy || !username.trim() || !password}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
              {busy ? '연결하는 중…' : '연결'}
            </button>
          </form>
          <div className="login-hint">
            {engine === 'agy' ? 'Agy의 Google 로그인은 터미널의 agy 인증을 그대로 사용합니다. ' : ''}
            앱 접속 아이디·비밀번호는 <code>.agent-web-auth.json</code> 또는{' '}
            <code>AGENT_WEB_USERNAME</code>/<code>AGENT_WEB_PASSWORD</code>로 설정됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
