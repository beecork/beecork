import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHANNEL_PREFIX = 'beecork-channel-';

export function channelInstall(packageName: string): void {
  // Normalize name
  const fullName = packageName.startsWith(CHANNEL_PREFIX) ? packageName : `${CHANNEL_PREFIX}${packageName}`;

  console.log(`Installing channel: ${fullName}...`);
  try {
    execSync(`npm install -g ${fullName}`, { stdio: 'inherit' });
    console.log(`\nChannel "${fullName}" installed.`);
    console.log('Restart the daemon to activate: beecork stop && beecork start');
  } catch (err) {
    console.error(`Failed to install ${fullName}. Check the package name and try again.`);
    process.exit(1);
  }
}

export function channelCreate(name: string): void {
  const pkgName = `${CHANNEL_PREFIX}${name}`;
  const dir = pkgName;

  if (fs.existsSync(dir)) {
    console.error(`Directory "${dir}" already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  // package.json
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: pkgName,
    version: '0.1.0',
    description: `Beecork channel: ${name}`,
    main: 'dist/index.js',
    type: 'module',
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
    },
    keywords: ['beecork', 'beecork-channel', name],
    peerDependencies: {
      beecork: '>=0.4.0',
    },
    devDependencies: {
      typescript: '^5.7.0',
      '@types/node': '^22.0.0',
    },
  }, null, 2) + '\n');

  // tsconfig.json
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      declaration: true,
    },
    include: ['src'],
  }, null, 2) + '\n');

  // Main source file
  const className = name.charAt(0).toUpperCase() + name.slice(1);
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), `// ${pkgName} — Beecork channel implementation
// See: https://github.com/beecork/beecork for Channel interface docs

// Import the Channel interface type from beecork
// Note: beecork is a peer dependency
interface Channel {
  readonly id: string;
  readonly name: string;
  readonly maxMessageLength: number;
  readonly supportsStreaming: boolean;
  readonly supportsMedia: boolean;
  start(): Promise<void>;
  stop(): void;
  sendMessage(peerId: string, text: string): Promise<void>;
  sendNotification(message: string, urgent?: boolean): Promise<void>;
  setTyping(peerId: string, active: boolean): Promise<void>;
  onMessage(handler: (msg: any) => Promise<void>): void;
}

interface ChannelContext {
  config: any;
  tabManager: any;
  pipeBrain: any;
}

export default class ${className}Channel implements Channel {
  readonly id = '${name}';
  readonly name = '${className}';
  readonly maxMessageLength = 4096;
  readonly supportsStreaming = false;
  readonly supportsMedia = false;

  private ctx: ChannelContext;
  private handler: ((msg: any) => Promise<void>) | null = null;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    // TODO: Connect to your service, start polling/websocket
    console.log(\`${name} channel started\`);
  }

  stop(): void {
    // TODO: Disconnect, cleanup
    console.log(\`${name} channel stopped\`);
  }

  onMessage(handler: (msg: any) => Promise<void>): void {
    this.handler = handler;
  }

  async sendMessage(peerId: string, text: string): Promise<void> {
    // TODO: Send a message to the user
  }

  async sendNotification(message: string, urgent?: boolean): Promise<void> {
    // TODO: Send a notification to all configured users
  }

  async setTyping(peerId: string, active: boolean): Promise<void> {
    // TODO: Show typing indicator
  }
}
`);

  // README
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${pkgName}

A Beecork channel plugin for ${name}.

## Installation

\`\`\`bash
beecork channel install ${name}
# or: npm install -g ${pkgName}
\`\`\`

## Configuration

Add to your \`~/.beecork/config.json\`:

\`\`\`json
{
  "${name}": {
    "enabled": true
  }
}
\`\`\`

## Development

\`\`\`bash
npm install
npm run build
\`\`\`

## Publishing

\`\`\`bash
npm publish
\`\`\`
`);

  console.log(`\nChannel scaffold created: ${dir}/`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${dir}`);
  console.log(`  npm install`);
  console.log(`  # Edit src/index.ts to implement your channel`);
  console.log(`  npm run build`);
  console.log(`  npm publish`);
}

export function channelList(): void {
  try {
    const output = execSync('npm list -g --depth=0', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = output.split('\n').filter(line => line.includes(CHANNEL_PREFIX));
    if (lines.length === 0) {
      console.log('No community channels installed.');
      console.log(`Install one: beecork channel install <name>`);
      return;
    }
    console.log(`\n${lines.length} community channel(s):\n`);
    for (const line of lines) {
      console.log(`  ${line.trim()}`);
    }
    console.log('');
  } catch {
    console.log('No community channels installed.');
  }
}
