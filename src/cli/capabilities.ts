import readline from 'node:readline';

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise(r => rl.question(prompt, a => r(a.trim() || defaultValue || '')));
}

export async function enableCapability(packId: string): Promise<void> {
  const { getAvailablePacks, isEnabled, enablePack } = await import('../capabilities/index.js');
  const packs = getAvailablePacks();
  const pack = packs.find(p => p.id === packId);

  if (!pack) {
    console.log(`Unknown capability: "${packId}"`);
    console.log('Available: ' + packs.map(p => p.id).join(', '));
    return;
  }

  if (isEnabled(packId)) {
    console.log(`${pack.name} is already enabled. Re-configuring...`);
  }

  console.log(`\n${pack.name}`);
  console.log(`  ${pack.description}\n`);

  let apiKey: string | undefined;
  if (pack.requiresApiKey) {
    if (pack.setupUrl) {
      console.log(`  Setup guide: ${pack.setupUrl}\n`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    apiKey = await ask(rl, `  ${pack.apiKeyHint || 'API key'}`);
    rl.close();
    if (!apiKey) {
      console.log('  No API key provided. Cancelled.');
      return;
    }
  }

  enablePack(packId, apiKey);
  console.log(`\n✓ ${pack.name} enabled.`);
  console.log('  Restart daemon to activate: beecork stop && beecork start\n');
}

export async function listCapabilities(): Promise<void> {
  const { getAvailablePacks, isEnabled } = await import('../capabilities/index.js');
  const packs = getAvailablePacks();

  console.log('\nCapabilities:\n');

  const categories = ['productivity', 'development', 'data', 'web'] as const;
  const categoryNames: Record<string, string> = {
    productivity: 'Productivity',
    development: 'Development',
    data: 'Data',
    web: 'Web',
  };

  for (const category of categories) {
    const categoryPacks = packs.filter(p => p.category === category);
    if (categoryPacks.length === 0) continue;

    console.log(`  ${categoryNames[category]}:`);
    for (const pack of categoryPacks) {
      const status = isEnabled(pack.id) ? '✓' : '○';
      const keyNeeded = pack.requiresApiKey ? ' (needs API key)' : '';
      console.log(`    ${status} ${pack.id} — ${pack.name}${keyNeeded}`);
    }
    console.log('');
  }

  console.log('  Enable: beecork enable <name>');
  console.log('  Example: beecork enable github\n');
}

export async function disableCapability(packId: string): Promise<void> {
  const { disablePack, isEnabled } = await import('../capabilities/index.js');
  if (!isEnabled(packId)) {
    console.log(`${packId} is not enabled.`);
    return;
  }
  disablePack(packId);
  console.log(`\n✓ ${packId} disabled.`);
  console.log('  Restart daemon to apply: beecork stop && beecork start\n');
}
