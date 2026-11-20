import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import anime from 'animejs';
import {
  Bot,
  Code2,
  Eye,
  Info,
  Link2,
  LogOut,
  MessageSquare,
  Pin,
  RotateCw,
  Sparkles,
  Sun,
} from 'lucide-react';
import { api, type AgyStatus } from '../lib/api';
import { engineLabel, getEngine, switchEngine } from '../lib/engine';
import { saveSettings, useAppSettings } from '../lib/preferences';

type SettingsTab =
  | 'display'
  | 'conversation'
  | 'pin'
  | 'model'
  | 'showcase'
  | 'connection'
  | 'info';

type ConnectionState = 'connecting' | 'online' | 'offline';

const TABS: { id: SettingsTab; label: string; icon: typeof Sun }[] = [
  { id: 'display', label: '화면', icon: Sun },
  { id: 'conversation', label: '대화', icon: MessageSquare },
  { id: 'pin', label: 'Pin', icon: Pin },
  { id: 'model', label: '모델', icon: Code2 },
  { id: 'showcase', label: '쇼케이스', icon: Eye },
  { id: 'connection', label: '연결', icon: Link2 },
  { id: 'info', label: '정보', icon: Info },
];

type Props = {
  open: boolean;
  onClose: () => void;
  modelName: string;
  connection: ConnectionState;
  pinnedCount: number;
  onOpenInfo: () => void;
  onOpenModel: () => void;
  onLogout: () => void;
};

export function SettingsPanel({
  open,
  onClose,
  modelName,
  connection,
  pinnedCount,
  onOpenInfo,
  onOpenModel,
  onLogout,
}: Props) {
  const [mounted, setMounted] = useState(open);
  const [tab, setTab] = useState<SettingsTab>('conversation');
  const settings = useAppSettings();
  const [agyStatus, setAgyStatus] = useState<AgyStatus | null>(null);
  const engine = getEngine();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    if (open) {
      anime({ targets: backdrop, opacity: [0, 1], duration: 200, easing: 'linear' });
      anime({
        targets: panel,
        opacity: [0, 1],
        translateY: [16, 0],
        duration: 300,
        easing: 'cubicBezier(0.22, 1, 0.36, 1)',
      });
    } else {
      anime({ targets: backdrop, opacity: [1, 0], duration: 180, easing: 'linear' });
      anime({
        targets: panel,
        opacity: [1, 0],
        translateY: [0, 12],
        duration: 220,
        easing: 'easeInCubic',
        complete: () => setMounted(false),
      });
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mounted, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'connection') return;
    let alive = true;
    setAgyStatus(null);
    void api.agyStatus().then((status) => {
      if (alive) setAgyStatus(status);
    });
    return () => {
      alive = false;
    };
  }, [open, tab]);

  if (!mounted) return null;

  const checkAgy = () => {
    setAgyStatus(null);
    void api.agyStatus().then(setAgyStatus);
  };
  const agyClass = agyStatus === null ? 'connecting' : agyStatus.ok ? 'online' : 'offline';

  const update = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    saveSettings({ ...settings, [key]: value });
  };

  const toggle = (key: keyof typeof settings) => {
    const value = !settings[key];
    update(key, value);
    if (key === 'notifications' && value && 'Notification' in window) {
      if (Notification.permission === 'default') void Notification.requestPermission();
    }
  };

  return createPortal(
    <div className="settings-layer">
      <div className="settings-backdrop" ref={backdropRef} onClick={onClose} />
      <section
        className="settings-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="설정"
      >
        <header className="settings-head">
          <h1 className="settings-title">설정</h1>
          <button className="settings-close" onClick={onClose}>
            닫기
          </button>
        </header>

        <nav className="settings-tabs" aria-label="설정 탭">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`settings-tab ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-body">
          {tab === 'conversation' && (
            <>
              <section className="settings-section">
                <h2 className="settings-section-title">생각 블록과 알림</h2>
                <SettingRow
                  title="생각 블록을 작성 중에 펼쳐서 보기"
                  checked={settings.expandThinking}
                  onChange={() => toggle('expandThinking')}
                />
                <SettingRow
                  title="다른 화면에 있을 때 작업 완료와 확인 요청을 알림"
                  checked={settings.notifications}
                  onChange={() => toggle('notifications')}
                />
                <p className="settings-note">
                  이 주소(HTTP)에서는 데스크톱 알림을 쓸 수 없어 탭 제목과 소리로만
                  알립니다. HTTPS나 localhost로 열면 데스크톱 알림이 됩니다.
                </p>
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">입력창 아래 표시</h2>
                <SettingRow
                  title="컨텍스트 링"
                  checked={settings.contextRing}
                  onChange={() => toggle('contextRing')}
                />
                <SettingRow
                  title="구독 한도"
                  description="ChatGPT·Claude 구독 모델일 때만 나옵니다."
                  checked={settings.subscriptionLimit}
                  onChange={() => toggle('subscriptionLimit')}
                />
                <SettingRow
                  title="구독 한도 숫자"
                  checked={settings.subscriptionNumbers}
                  onChange={() => toggle('subscriptionNumbers')}
                />
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">API 재시도</h2>
                <SettingRow
                  title="100h 모드"
                  description="3번 실패하면 60분마다 다시 시도합니다. 최대 100번이고, 창을 닫아도 서버에서 계속합니다."
                  checked={settings.retry100h}
                  onChange={() => toggle('retry100h')}
                />
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">구독 한도</h2>
                <SettingRow
                  title="Zero-Waste"
                  description="5시간 한도에 걸려 멈추면 초기화된 뒤 아래 문구를 보내 이어서 진행합니다. 창을 닫아도 서버에서 계속합니다."
                  checked={settings.zeroWaste}
                  onChange={() => toggle('zeroWaste')}
                />
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">보낸 문구</h2>
                <input
                  className="settings-input"
                  value={settings.followUp}
                  onChange={(event) => update('followUp', event.target.value)}
                  placeholder="계속해"
                  spellCheck={false}
                />
              </section>
            </>
          )}

          {tab === 'display' && (
            <section className="settings-section">
              <h2 className="settings-section-title">화면</h2>
              <div className="settings-line">
                <span>테마</span>
                <strong className="settings-value">다크</strong>
              </div>
              <div className="settings-line">
                <span>밀도</span>
                <strong className="settings-value">보통</strong>
              </div>
              <p className="settings-note">
                모바일 화면을 기준으로 한 다크 테마입니다. 화면 설정은 이 기기에만
                저장됩니다.
              </p>
            </section>
          )}

          {tab === 'pin' && (
            <section className="settings-section">
              <h2 className="settings-section-title">Pin</h2>
              <div className="settings-line">
                <span>Pin한 파일</span>
                <strong className="settings-value">{pinnedCount}개</strong>
              </div>
              <button className="settings-action" onClick={onOpenInfo}>
                정보 패널의 Pin 탭 열기
              </button>
            </section>
          )}

          {tab === 'model' && (
            <section className="settings-section">
              <h2 className="settings-section-title">모델</h2>
              <div className="settings-line">
                <span>현재 모델</span>
                <strong className="settings-value">{modelName}</strong>
              </div>
              <button className="settings-action" onClick={onOpenModel}>
                모델 변경
              </button>
            </section>
          )}

          {tab === 'showcase' && (
            <section className="settings-section">
              <h2 className="settings-section-title">쇼케이스</h2>
              <SettingRow
                title="도구 결과를 쇼케이스로 표시"
                description="도구 실행 결과를 접지 않고 카드 형태로 보여줍니다."
                checked={settings.showcase}
                onChange={() => toggle('showcase')}
              />
            </section>
          )}

          {tab === 'connection' && (
            <>
              <section className="settings-section">
                <h2 className="settings-section-title">에이전트 엔진</h2>
                <div className="engine-choice" role="radiogroup" aria-label="에이전트 엔진">
                  <button
                    className={engine === 'agy' ? 'selected' : ''}
                    role="radio"
                    aria-checked={engine === 'agy'}
                    onClick={() => switchEngine('agy')}
                  >
                    <span className="engine-choice-head">
                      <Sparkles size={15} />
                      Agy
                      {engine === 'agy' && <em>사용 중</em>}
                    </span>
                    <span className="engine-choice-desc">
                      ACP · Antigravity
                      {agyStatus?.ok && agyStatus.version ? ` v${agyStatus.version}` : ''}
                    </span>
                  </button>
                  <button
                    className={engine === 'opencode' ? 'selected' : ''}
                    role="radio"
                    aria-checked={engine === 'opencode'}
                    onClick={() => switchEngine('opencode')}
                  >
                    <span className="engine-choice-head">
                      <Code2 size={15} />
                      OpenCode
                      {engine === 'opencode' && <em>사용 중</em>}
                    </span>
                    <span className="engine-choice-desc">HTTP · port 4097</span>
                  </button>
                  <button
                    className={engine === 'codex' ? 'selected' : ''}
                    role="radio"
                    aria-checked={engine === 'codex'}
                    onClick={() => switchEngine('codex')}
                  >
                    <span className="engine-choice-head">
                      <Bot size={15} />
                      Codex
                      {engine === 'codex' && <em>사용 중</em>}
                    </span>
                    <span className="engine-choice-desc">CLI · ChatGPT</span>
                  </button>
                </div>
                <p className="settings-note">
                  엔진을 바꾸면 페이지가 새로고침됩니다. 세션과 모델 선택은 엔진별로
                  분리됩니다.
                </p>
              </section>

              <section className="settings-section">
                <h2 className="settings-section-title">연결 상태</h2>
                <div className="settings-line">
                  <span>현재 엔진</span>
                  <strong className="settings-value">{engineLabel(engine)}</strong>
                </div>
                <div className="settings-line">
                  <span>Agy ACP</span>
                  <strong className={`settings-value settings-status ${agyClass}`}>
                    <i />
                    {agyStatus === null
                      ? '확인 중'
                      : agyStatus.ok
                        ? `연결됨 · v${agyStatus.version || 'unknown'}`
                        : '연결 안 됨'}
                  </strong>
                </div>
                <div className="settings-line">
                  <span>Agy 모델</span>
                  <strong className="settings-value">
                    {agyStatus?.models ? `${agyStatus.models}개` : '—'}
                  </strong>
                </div>
                <div className="settings-line">
                  <span>실시간 이벤트</span>
                  <strong className={`settings-value settings-status ${connection}`}>
                    <i />
                    {connection === 'online'
                      ? '연결됨'
                      : connection === 'connecting'
                        ? '연결 중'
                        : '연결 끊김'}
                  </strong>
                </div>
                {agyStatus && !agyStatus.ok && (
                  <p className="settings-error">{agyStatus.error || 'Agy 브리지에 연결할 수 없어요.'}</p>
                )}
                <button className="settings-action" onClick={checkAgy}>
                  <RotateCw size={15} />
                  Agy 연결 다시 확인
                </button>
                <button className="settings-action danger" onClick={onLogout}>
                  <LogOut size={15} />
                  접속 해제
                </button>
              </section>
            </>
          )}

          {tab === 'info' && (
            <section className="settings-section">
              <h2 className="settings-section-title">정보</h2>
              <div className="settings-line">
                <span>Agent Studio</span>
                <strong className="settings-value">v0.3</strong>
              </div>
              <div className="settings-line">
                <span>에이전트 엔진</span>
                <strong className="settings-value">
                  {engine === 'agy'
                    ? `Agy ${agyStatus?.version ? `v${agyStatus.version}` : 'ACP'}`
                    : engine === 'codex'
                      ? 'Codex CLI'
                      : 'OpenCode 4097'}
                </strong>
              </div>
              <div className="settings-line">
                <span>글꼴</span>
                <strong className="settings-value">Maplestory OTF</strong>
              </div>
              <button className="settings-action" onClick={() => window.location.reload()}>
                <RotateCw size={15} />
                새로고침
              </button>
              <p className="settings-note">
                화면이 예전 상태로 보이면 새로고침해서 최신 화면을 불러와 주세요.
              </p>
            </section>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SettingRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <button
        className={`settings-switch ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
      >
        <span className="settings-knob" />
      </button>
    </div>
  );
}
