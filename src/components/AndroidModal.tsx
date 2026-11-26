import { useState } from 'react';
import { ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';

const VNC_URL =
  '/android-vnc/vnc.html?autoconnect=1&resize=scale&path=android-vnc/websockify';

export function AndroidModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);

  if (!open) return null;

  return (
    <div className="android-modal-layer" role="dialog" aria-modal="true" aria-label="안드로이드 noVNC">
      <div className="android-modal-backdrop" onClick={onClose} />
      <div className="android-modal">
        <header className="android-modal-head">
          <div className="android-modal-title">
            <span className="android-modal-mark">
              <Smartphone size={16} />
            </span>
            <div>
              <strong>Android 14 · Redroid</strong>
              <span>noVNC 원격 화면</span>
            </div>
          </div>
          <div className="android-modal-actions">
            <button
              type="button"
              className="desk-icon"
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label="새로고침"
              title="새로고침"
            >
              <RefreshCw size={15} />
            </button>
            <a
              className="desk-icon"
              href={VNC_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="새 탭에서 열기"
              title="새 탭에서 열기"
            >
              <ExternalLink size={15} />
            </a>
            <button
              type="button"
              className="desk-icon"
              onClick={onClose}
              aria-label="닫기"
              title="닫기"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="android-modal-body">
          <iframe
            key={reloadKey}
            src={VNC_URL}
            title="Android noVNC"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </div>
  );
}
