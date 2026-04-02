import type { CapabilityPack } from './types.js';

export const CAPABILITY_PACKS: CapabilityPack[] = [
  // Productivity
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write pages, databases, notes in Notion',
    category: 'productivity',
    mcpServer: {
      package: '@notionhq/notion-mcp-server',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ${NOTION_API_KEY}","Notion-Version":"2022-06-28"}' },
    },
    requiresApiKey: true,
    apiKeyHint: 'Notion integration token (from notion.so/my-integrations)',
    apiKeyEnvVar: 'NOTION_API_KEY',
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },

  // Development
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repos, PRs, issues, CI/CD workflows',
    category: 'development',
    mcpServer: {
      package: '@modelcontextprotocol/server-github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    },
    requiresApiKey: true,
    apiKeyHint: 'GitHub personal access token (from github.com/settings/tokens)',
    apiKeyEnvVar: 'GITHUB_TOKEN',
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },

  // Data
  {
    id: 'database',
    name: 'Database (PostgreSQL)',
    description: 'Query databases, inspect schemas, analyze data',
    category: 'data',
    mcpServer: {
      package: '@modelcontextprotocol/server-postgres',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
    },
    requiresApiKey: true,
    apiKeyHint: 'PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/db)',
    apiKeyEnvVar: 'DATABASE_URL',
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },
];
