import { useEffect, useState } from 'react';

export type AppSettings = {
  expandThinking: boolean;
  notifications: boolean;
  contextRing: boolean;
  subscriptionLimit: boolean;
  subscriptionNumbers: boolean;
  retry100h: boolean;
  zeroWaste: boolean;
  showcase: boolean;
  followUp: string;
};

export const SETTINGS_KEY = 'agent-web:settings';
const CHANGE_EVENT = 'agent-web:settings-changed';

export const DEFAULT_SETTINGS: AppSettings = {
  expandThinking: true,
  notifications: true,
  contextRing: true,
  subscriptionLimit: true,
  subscriptionNumbers: false,
  retry100h: true,
  zeroWaste: true,
  showcase: true,
  followUp: '계속해',
};

let cached: AppSettings | null = null;

function readSettings(): AppSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    cached = raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
      : DEFAULT_SETTINGS;
  } catch {
    cached = DEFAULT_SETTINGS;
  }
  return cached;
}

export function getSettings(): AppSettings {
  return readSettings();
}

export function saveSettings(settings: AppSettings) {
  cached = settings;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage can be unavailable in private modes; keep the in-memory value
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useAppSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(readSettings);

  useEffect(() => {
    const refresh = () => {
      cached = null;
      setSettings(readSettings());
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return settings;
}
