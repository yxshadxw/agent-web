import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  FolderTree,
  Gauge,
  GitBranch,
  GitCompareArrows,
  Info,
  Menu,
  MoreHorizontal,
  Pin,
  Plus,
  Settings,
  Trash2,
  Type,
  Copy,
} from 'lucide-react';
import type { AgentSession, PathInfo } from '../lib/api';
import { getEngine, type AgentEngine } from '../lib/engine';
import { baseName, shortPath, type InfoTab } from '../data';

type PanelKind = 'context' | 'usage';

type Props = {
  session: AgentSession | null;
  titleOverride?: string;
  canManageSession?: boolean;
  pathInfo: PathInfo | null;
  diffCount: number;
  onMenu: () => void;
  onOpenInfo: (tab?: InfoTab) => void;
  onOpenPanel: (kind: PanelKind) => void;
  onNewSession: () => void;
  onSettings: () => void;
  onOpenDesk: () => void;
  onOpenCodex: () => void;
  engineOverride?: AgentEngine;
  onRename: () => void;
  onDelete: () => void;
  onCopyId: () => void;
};

export function Header({
  session,
  titleOverride,
  canManageSession,
  pathInfo,
  diffCount,
  onMenu,
  onOpenInfo,
  onOpenPanel,
  onNewSession,
  onSettings,
  onOpenDesk,
  onOpenCodex,
  engineOverride,
  onRename,
  onDelete,
  onCopyId,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const directory = session?.directory || pathInfo?.worktree || '';
  const title = titleOverride || session?.title || baseName(directory) || '에이전트 스튜디오';
  const engine = engineOverride ?? getEngine();
  const hasSession = Boolean(canManageSession ?? session);

  const menuItems: {
    label: string;
    icon: ReactNode;
    tab?: InfoTab;
    panel?: PanelKind;
    action?: () => void;
    badge?: string;
    danger?: boolean;
    disabled?: boolean;
    separated?: boolean;
  }[] = [
    { label: '정보', icon: <Info size={16} />, tab: 'info' },
    { label: '파일', icon: <FolderTree size={16} />, tab: 'files' },
    {
      label: 'Diff',
      icon: <GitCompareArrows size={16} />,
      tab: 'diff',
      badge: diffCount ? String(diffCount) : undefined,
    },
    { label: 'Git', icon: <GitBranch size={16} />, tab: 'git' },
    { label: 'Pin', icon: <Pin size={16} />, tab: 'pin' },
    { label: '컨텍스트', icon: <Gauge size={16} />, panel: 'context', separated: true },
    { label: '사용량 한도', icon: <Activity size={16} />, panel: 'usage' },
    {
      label: engine === 'codex' ? 'Agy로 돌아가기' : 'Codex',
      icon: <Bot size={16} />,
      action: onOpenCodex,
      separated: true,
    },
    { label: '병렬 데스크', icon: <Boxes size={16} />, action: onOpenDesk },
    { label: '설정', icon: <Settings size={16} />, action: onSettings },
    { label: '새 세션', icon: <Plus size={16} />, action: onNewSession },
    { label: '타이틀 변경', icon: <Type size={16} />, action: onRename, disabled: !hasSession },
    { label: '세션 ID 복사', icon: <Copy size={16} />, action: onCopyId, disabled: !hasSession },
    {
      label: '세션 삭제',
      icon: <Trash2 size={16} />,
      action: onDelete,
      danger: true,
      disabled: !hasSession,
    },
  ];

  return (
    <header className="header">
      <button className="icon-btn" onClick={onMenu} aria-label="세션 목록 열기">
        <Menu size={21} />
      </button>

      <div className="header-titles">
        <h1 title={title}>{title}</h1>
        <div className="path" title={directory}>
          <span className={`engine-chip ${engine}`}>
            {engine === 'agy' ? 'AGY' : engine === 'codex' ? 'CX' : 'OC'}
          </span>
          <span className="path-text">{shortPath(directory)}</span>
        </div>
      </div>

      <div className="header-actions">
        <button
          className="icon-btn"
          onClick={onOpenCodex}
          aria-label={engine === 'codex' ? 'Agy로 돌아가기' : 'Codex 열기'}
          title={engine === 'codex' ? 'Agy로 돌아가기' : 'Codex'}
        >
          <Bot size={19} />
        </button>
        <button
          className="icon-btn"
          onClick={onOpenDesk}
          aria-label="병렬 데스크 열기"
          title="병렬 데스크"
        >
          <Boxes size={19} />
        </button>
        <button
          className={`icon-btn ${menuOpen ? 'is-active' : ''}`}
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="더 보기"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={21} />
        </button>
      </div>

      {menuOpen && (
        <div className="menu-pop" ref={popRef} role="menu">
          {menuItems.map((item) => (
            <button
              key={item.label}
              className={`menu-item ${item.separated ? 'with-sep' : ''} ${item.danger ? 'danger' : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setMenuOpen(false);
                if (item.tab) onOpenInfo(item.tab);
                else if (item.panel) onOpenPanel(item.panel);
                else item.action?.();
              }}
            >
              <span className="menu-ico">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge && <span className="menu-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
