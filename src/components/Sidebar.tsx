import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import anime from 'animejs';
import type { SessionStatus } from '@opencode-ai/sdk';
import {
  HelpCircle,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { AgentSession, PathInfo } from '../lib/api';
import { engineLabel, getEngine } from '../lib/engine';
import { baseName, dayLabel, relativeTime, shortPath } from '../data';
import { BrandGlyph } from './Brand';

type Props = {
  open: boolean;
  sessions: AgentSession[];
  activeID: string | null;
  statuses: Record<string, SessionStatus>;
  pathInfo: PathInfo | null;
  connection: 'connecting' | 'online' | 'offline';
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onDelete: (session: AgentSession) => void;
  onSettings: () => void;
  onLogout: () => void;
  onToast: (message: string) => void;
};

export function Sidebar({
  open,
  sessions,
  activeID,
  statuses,
  pathInfo,
  connection,
  onClose,
  onSelect,
  onNewSession,
  onDelete,
  onSettings,
  onLogout,
  onToast,
}: Props) {
  const [mounted, setMounted] = useState(open);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    if (open) {
      anime({ targets: backdrop, opacity: [0, 1], duration: 240, easing: 'linear' });
      anime({
        targets: panel,
        translateX: ['-100%', '0%'],
        duration: 380,
        easing: 'cubicBezier(0.22, 1, 0.36, 1)',
      });
      anime({
        targets: panel.querySelectorAll<HTMLElement>('.side-anim'),
        opacity: [0, 1],
        translateX: [-8, 0],
        delay: anime.stagger(28, { start: 80 }),
        duration: 320,
        easing: 'easeOutQuad',
      });
      window.setTimeout(() => searchRef.current?.focus(), 260);
    } else {
      anime({ targets: backdrop, opacity: [1, 0], duration: 200, easing: 'linear' });
      anime({
        targets: panel,
        translateX: ['0%', '-100%'],
        duration: 300,
        easing: 'easeInCubic',
        complete: () => setMounted(false),
      });
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted, open, onClose]);

  const groups = useMemo(() => {
    const topLevel = sessions.filter((session) => !session.parentID);
    const filtered = query.trim()
      ? topLevel.filter((session) => {
          const q = query.trim().toLowerCase();
          return (
            session.title.toLowerCase().includes(q) ||
            session.directory.toLowerCase().includes(q)
          );
        })
      : topLevel;
    const map = new Map<string, AgentSession[]>();
    for (const session of filtered) {
      const label = dayLabel(session.time.updated);
      const bucket = map.get(label) ?? [];
      bucket.push(session);
      map.set(label, bucket);
    }
    return [...map.entries()];
  }, [sessions, query]);

  const directory = pathInfo?.worktree || sessions[0]?.directory || '';
  const engine = getEngine();

  if (!mounted) return null;

  return createPortal(
    <div className="panel-layer">
      <div className="panel-backdrop" ref={backdropRef} onClick={onClose} />
      <aside className="sidebar" ref={panelRef} role="dialog" aria-modal="true" aria-label="세션 목록">
        <div className="side-head side-anim">
          <BrandGlyph />
          <div>
            <div className="side-title">{baseName(directory)}</div>
            <div className="side-path">{shortPath(directory)}</div>
          </div>
          <button className="side-close" onClick={onClose} aria-label="닫기">
            <X size={19} />
          </button>
        </div>

        <div className="side-actions side-anim">
          <div className="side-search real">
            <Search size={15} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="세션 검색"
              aria-label="세션 검색"
            />
          </div>
          <button
            className="new-session"
            onClick={() => {
              onNewSession();
              onClose();
            }}
          >
            <Plus size={16} />
            새 세션
          </button>
        </div>

        <div className="side-list real-list">
          {groups.length === 0 && (
            <div className="side-empty">{query ? '검색 결과가 없어요' : '아직 세션이 없어요'}</div>
          )}
          {groups.map(([label, items]) => (
            <div className="side-group" key={label}>
              <div className="side-label side-anim">{label}</div>
              {items.map((session) => {
                const status = statuses[session.id];
                const working = status?.type === 'busy' || status?.type === 'retry';
                return (
                  <div
                    className={`side-item side-anim ${activeID === session.id ? 'active' : ''}`}
                    key={session.id}
                  >
                    <button className="side-open" onClick={() => onSelect(session.id)}>
                      <span className="side-item-title">
                        {working && <i className={`side-live ${status?.type}`} />}
                        {session.title}
                      </span>
                      <span className="side-item-meta">
                        <span>{shortPath(session.directory)}</span>
                        <span>{relativeTime(session.time.updated)}</span>
                      </span>
                    </button>
                    <button
                      className="side-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(session);
                      }}
                      aria-label="세션 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="side-foot side-anim">
          <div className={`side-conn ${connection}`}>
            <span className="status-dot" />
            {connection === 'online'
              ? `${engineLabel(engine)} 연결됨`
              : connection === 'connecting'
                ? '연결 중…'
                : '연결 끊김'}
          </div>
          <button className="side-foot-item side-settings" onClick={onSettings}>
            <Settings size={16} />
            설정
          </button>
          <div className="side-foot-row">
            <button className="side-foot-item" onClick={onLogout}>
              <LogOut size={16} />
              접속 해제
            </button>
            <button
              className="side-foot-item"
              onClick={() => onToast('에이전트는 현재 워크스페이스를 직접 실행해요')}
            >
              <HelpCircle size={16} />
              도움말
            </button>
          </div>
          <div className="side-version">
            <Sparkles size={13} />
            agent studio v0.3 · {engineLabel(engine)}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
