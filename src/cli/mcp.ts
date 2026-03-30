import fs from 'node:fs';
import { getBeecorkHome } from '../util/paths.js';

const MCP_CONFIG_PATH = `${getBeecorkHome()}/mcp-config.json`;

interface MCPConfig {
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

function loadMcpConfig(): MCPConfig {
  if (fs.existsSync(MCP_CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
  }
  return { mcpServers: {} };
}

function saveMcpConfig(config: MCPConfig): void {
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function mcpAdd(name: string, command: string, args: string[]): void {
  const config = loadMcpConfig();
  if (config.mcpServers[name]) {
    console.log(`Updating existing MCP server: ${name}`);
  }
  config.mcpServers[name] = { command, args: args.length > 0 ? args : undefined };
  saveMcpConfig(config);
  console.log(`MCP server "${name}" registered.`);
  console.log(`  Command: ${command}${args.length ? ' ' + args.join(' ') : ''}`);
}

export function mcpRemove(name: string): void {
  const config = loadMcpConfig();
  if (!config.mcpServers[name]) {
    console.log(`MCP server "${name}" not found.`);
    return;
  }
  delete config.mcpServers[name];
  saveMcpConfig(config);
  console.log(`MCP server "${name}" removed.`);
}

export function mcpList(): void {
  const config = loadMcpConfig();
  const servers = Object.entries(config.mcpServers);
  if (servers.length === 0) {
    console.log('No MCP servers configured.');
    console.log('Add one: beecork mcp add <name> <command> [args...]');
    return;
  }
  console.log(`\n${servers.length} MCP server(s):\n`);
  for (const [name, server] of servers) {
    const args = server.args ? ' ' + server.args.join(' ') : '';
    console.log(`  ${name}: ${server.command}${args}`);
  }
  console.log('');
}
