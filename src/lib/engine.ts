export type AgentEngine = 'agy' | 'opencode' | 'codex';

const ENGINE_KEY = 'agent-web:engine';
const SESSION_KEYS = [
  'agent-web:last-session',
  'agent-web:last-session:agy',
  'agent-web:last-session:opencode',
  'agent-web:last-session:codex',
];
const MODEL_KEYS = [
  'agent-web:model',
  'agent-web:model:agy',
  'agent-web:model:opencode',
  'agent-web:model:codex',
];

export function getEngine(): AgentEngine {
  try {
    const stored = localStorage.getItem(ENGINE_KEY);
    if (stored === 'opencode' || stored === 'codex') return stored;
    return 'agy';
  } catch {
    return 'agy';
  }
}

export function setEngine(engine: AgentEngine) {
  localStorage.setItem(ENGINE_KEY, engine);
}

export function apiBase() {
  // Codex has its own /codex-api panel and does not use the OpenCode API.
  // The shell still checks login through the normal API before showing it.
  return getEngine() === 'agy' ? '/agy-api' : '/api';
}

export function engineLabel(engine = getEngine()) {
  if (engine === 'agy') return 'Agy';
  if (engine === 'codex') return 'Codex';
  return 'OpenCode';
}

export type EnginePreselect = {
  providerID?: string;
  modelID?: string;
  codexModel?: string;
};

/**
 * Session IDs and model IDs are engine-specific. Reload after changing engines
 * so no hook keeps a stale EventSource or a session from the other backend.
 */
export function switchEngine(engine: AgentEngine, preselect?: EnginePreselect) {
  if (engine === getEngine()) return;
  setEngine(engine);
  for (const key of SESSION_KEYS) {
    localStorage.removeItem(key);
  }
  if (preselect?.codexModel !== undefined) {
    localStorage.setItem('agent-web:codex-pending-model', preselect.codexModel);
  } else if (preselect?.providerID && preselect?.modelID) {
    localStorage.setItem(
      `agent-web:model:${engine}`,
      JSON.stringify({
        providerID: preselect.providerID,
        modelID: preselect.modelID,
        variant: '',
      }),
    );
  } else {
    for (const key of MODEL_KEYS) {
      localStorage.removeItem(key);
    }
  }
  window.location.reload();
}
