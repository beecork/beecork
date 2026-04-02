import type { CapabilityPack } from './types.js';

export const CAPABILITY_PACKS: CapabilityPack[] = [
  // Productivity
  {
    id: 'email',
    name: 'Email (Gmail)',
    description: 'Read, send, and manage emails via Gmail',
    category: 'productivity',
    mcpServer: {
      package: '@anthropic/gmail-mcp',
      command: 'npx',
      args: ['-y', '@anthropic/gmail-mcp'],
    },
    requiresApiKey: true,
    apiKeyHint: 'Google OAuth credentials (follow the setup guide)',
    apiKeyEnvVar: 'GOOGLE_OAUTH_CREDENTIALS',
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },
  {
    id: 'calendar',
    name: 'Calendar (Google)',
    description: 'Schedule meetings, check availability, manage events',
    category: 'productivity',
    mcpServer: {
      package: '@anthropic/google-calendar-mcp',
      command: 'npx',
      args: ['-y', '@anthropic/google-calendar-mcp'],
    },
    requiresApiKey: true,
    apiKeyHint: 'Google OAuth credentials (same as email if already set up)',
    apiKeyEnvVar: 'GOOGLE_OAUTH_CREDENTIALS',
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },
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
  {
    id: 'drive',
    name: 'Google Drive',
    description: 'Search, read, and organize files in Google Drive',
    category: 'productivity',
    mcpServer: {
      package: '@anthropic/gdrive-mcp',
      command: 'npx',
      args: ['-y', '@anthropic/gdrive-mcp'],
    },
    requiresApiKey: true,
    apiKeyHint: 'Google OAuth credentials',
    apiKeyEnvVar: 'GOOGLE_OAUTH_CREDENTIALS',
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

  // Web
  {
    id: 'web',
    name: 'Web Browsing',
    description: 'Search the web, fetch and read web pages',
    category: 'web',
    mcpServer: {
      package: '@anthropic/web-search-mcp',
      command: 'npx',
      args: ['-y', '@anthropic/web-search-mcp'],
    },
    requiresApiKey: false,
    setupUrl: 'https://github.com/beecork/beecork/blob/main/docs/use-cases.md',
  },
];
