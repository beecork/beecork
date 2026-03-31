import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getConfig, saveConfig } from '../config.js';
import { getMcpConfigPath } from '../util/paths.js';
import { logger } from '../util/logger.js';
import { CAPABILITY_PACKS } from './packs.js';
import type { CapabilityPack, EnabledCapability } from './types.js';

/** Get all available packs */
export function getAvailablePacks(): CapabilityPack[] {
  return CAPABILITY_PACKS;
}

/** Get enabled capabilities from config */
export function getEnabledCapabilities(): EnabledCapability[] {
  const config = getConfig();
  return (config as any).capabilities || [];
}

/** Check if a pack is enabled */
export function isEnabled(packId: string): boolean {
  return getEnabledCapabilities().some(c => c.packId === packId);
}

/** Enable a capability pack */
export function enablePack(packId: string, apiKey?: string): void {
  const pack = CAPABILITY_PACKS.find(p => p.id === packId);
  if (!pack) throw new Error(`Unknown capability: ${packId}. Use 'beecork capabilities' to list.`);

  if (pack.requiresApiKey && !apiKey) {
    throw new Error(`${pack.name} requires an API key. Hint: ${pack.apiKeyHint}`);
  }

  // Install the MCP server package
  try {
    console.log(`Installing ${pack.mcpServer.package}...`);
    execSync(`npm install -g ${pack.mcpServer.package}`, { stdio: 'pipe' });
  } catch (err) {
    logger.warn(`Package install skipped (may already be available via npx): ${pack.mcpServer.package}`);
  }

  // Update config
  const config = getConfig();
  const capabilities: EnabledCapability[] = (config as any).capabilities || [];
  const existing = capabilities.findIndex(c => c.packId === packId);
  const entry: EnabledCapability = { packId, apiKey, enabledAt: new Date().toISOString() };
  if (existing >= 0) {
    capabilities[existing] = entry;
  } else {
    capabilities.push(entry);
  }
  (config as any).capabilities = capabilities;
  saveConfig(config);

  // Update MCP config
  updateMcpConfig();

  logger.info(`Capability enabled: ${pack.name}`);
}

/** Disable a capability pack */
export function disablePack(packId: string): void {
  const config = getConfig();
  const capabilities: EnabledCapability[] = (config as any).capabilities || [];
  (config as any).capabilities = capabilities.filter(c => c.packId !== packId);
  saveConfig(config);
  updateMcpConfig();
  logger.info(`Capability disabled: ${packId}`);
}

/** Regenerate MCP config based on enabled capabilities */
export function updateMcpConfig(): void {
  const mcpConfigPath = getMcpConfigPath();
  let mcpConfig: any = { mcpServers: {} };

  // Load existing MCP config (preserves beecork's own MCP server)
  if (fs.existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    } catch {}
  }

  // Remove old capability servers (they start with 'cap-')
  for (const key of Object.keys(mcpConfig.mcpServers)) {
    if (key.startsWith('cap-')) delete mcpConfig.mcpServers[key];
  }

  // Add enabled capability servers
  const capabilities = getEnabledCapabilities();
  for (const cap of capabilities) {
    const pack = CAPABILITY_PACKS.find(p => p.id === cap.packId);
    if (!pack) continue;

    // Resolve env vars
    const env: Record<string, string> = {};
    if (pack.mcpServer.env) {
      for (const [key, template] of Object.entries(pack.mcpServer.env)) {
        env[key] = template.replace(/\$\{(\w+)\}/g, (_, varName) => {
          if (varName === pack.apiKeyEnvVar) return cap.apiKey || '';
          return process.env[varName] || '';
        });
      }
    }
    if (cap.apiKey && pack.apiKeyEnvVar) {
      env[pack.apiKeyEnvVar] = cap.apiKey;
    }

    // Resolve args templates
    const args = (pack.mcpServer.args || []).map(arg =>
      arg.replace(/\$\{(\w+)\}/g, (_, varName) => {
        if (varName === pack.apiKeyEnvVar) return cap.apiKey || '';
        return process.env[varName] || '';
      })
    );

    mcpConfig.mcpServers[`cap-${cap.packId}`] = {
      command: pack.mcpServer.command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n', { mode: 0o600 });
}
