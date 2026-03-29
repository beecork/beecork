import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfigPath, expandHome } from './util/paths.js';
import type { BeecorkConfig, TabConfig } from './types.js';

const DEFAULT_TAB_CONFIG: TabConfig = {
  workingDir: os.homedir(),
  approvalMode: 'yolo',
  approvalTimeoutMinutes: 30,
  debounceMs: 1500,
};

const DEFAULT_PIPE_CONFIG: BeecorkConfig['pipe'] = {
  enabled: false,
  anthropicApiKey: '',
  routingModel: 'claude-haiku-4-5-20251001',
  complexModel: 'claude-sonnet-4-6-20250514',
  confidenceThreshold: 0.75,
  projectScanPaths: ['~/Coding', '~/Projects', '~/code', '~/dev'],
  maxFollowUps: 5,
};

const DEFAULT_CONFIG: BeecorkConfig = {
  telegram: {
    token: '',
    allowedUserIds: [],
  },
  claudeCode: {
    bin: 'claude',
    defaultFlags: ['--dangerously-skip-permissions'],
  },
  tabs: {
    default: { ...DEFAULT_TAB_CONFIG },
  },
  memory: {
    enabled: true,
    dbPath: '~/.beecork/memory.db',
    maxLongTermEntries: 1000,
  },
  pipe: { ...DEFAULT_PIPE_CONFIG },
  deployment: 'local',
};

let cachedConfig: BeecorkConfig | null = null;

export function getConfig(): BeecorkConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cachedConfig = mergeWithDefaults(raw);
    return cachedConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log to stderr since logger may not be initialized yet
    console.error(`Warning: Failed to parse config file ${configPath}: ${msg} — using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: BeecorkConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  fs.chmodSync(configPath, 0o600); // Owner-only read/write — contains API keys
  cachedConfig = config;
}

export function getTabConfig(tabName: string): TabConfig {
  const config = getConfig();
  return config.tabs[tabName] ?? { ...DEFAULT_TAB_CONFIG };
}

export function resolveWorkingDir(tabName: string): string {
  const tabConfig = getTabConfig(tabName);
  return expandHome(tabConfig.workingDir);
}

export function getAdminUserId(): number {
  const config = getConfig();
  return config.telegram.adminUserId ?? config.telegram.allowedUserIds[0];
}

const TAB_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/;

export function validateTabName(name: string): string | null {
  if (name === 'default') return 'Tab name "default" is reserved';
  if (name.startsWith('cron:')) return 'Tab names starting with "cron:" are reserved';
  if (!TAB_NAME_REGEX.test(name)) return 'Tab name must be alphanumeric + hyphens, max 32 chars';
  return null; // valid
}

function mergeWithDefaults(raw: Partial<BeecorkConfig>): BeecorkConfig {
  return {
    telegram: {
      ...DEFAULT_CONFIG.telegram,
      ...raw.telegram,
    },
    claudeCode: {
      ...DEFAULT_CONFIG.claudeCode,
      ...raw.claudeCode,
    },
    tabs: {
      default: { ...DEFAULT_TAB_CONFIG },
      ...Object.fromEntries(
        Object.entries(raw.tabs ?? {}).map(([k, v]) => [
          k,
          { ...DEFAULT_TAB_CONFIG, ...v },
        ])
      ),
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...raw.memory,
    },
    pipe: {
      ...DEFAULT_PIPE_CONFIG,
      ...raw.pipe,
    },
    deployment: raw.deployment ?? DEFAULT_CONFIG.deployment,
  };
}
