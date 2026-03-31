import readline from 'node:readline';

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise(r => rl.question(prompt, a => r(a.trim() || defaultValue || '')));
}

const IMAGE_PROVIDERS = [
  { id: 'dall-e', name: 'DALL-E (OpenAI)', keyHint: 'OpenAI API key (sk-...)' },
  { id: 'stable-diffusion', name: 'Stable Diffusion (Stability AI)', keyHint: 'Stability AI API key' },
  { id: 'imagen', name: 'Google Imagen', keyHint: 'Google AI API key (from ai.google.dev)' },
];

const VIDEO_PROVIDERS = [
  { id: 'runway', name: 'Runway Gen-3', keyHint: 'Runway API key' },
  { id: 'veo', name: 'Google Veo', keyHint: 'Google AI API key' },
  { id: 'kling', name: 'Kling AI', keyHint: 'Kling API key' },
];

const AUDIO_PROVIDERS = [
  { id: 'elevenlabs-sfx', name: 'ElevenLabs (Sound Effects)', keyHint: 'ElevenLabs API key (xi-...)' },
];

export async function mediaSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { getConfig, saveConfig } = await import('../config.js');
  const config = getConfig();
  const generators: Array<{ provider: string; apiKey: string; model?: string }> = (config as any).mediaGenerators || [];

  console.log('\nMedia Generation Setup\n');
  console.log('Configure AI providers for generating images, videos, and audio.');
  console.log('You need API keys from each provider.\n');
  console.log('Already configured: ' + (generators.length > 0 ? generators.map(g => g.provider).join(', ') : 'none'));
  console.log('');

  // Image providers
  console.log('Image Generation:');
  for (let i = 0; i < IMAGE_PROVIDERS.length; i++) {
    console.log(`  ${i + 1}) ${IMAGE_PROVIDERS[i].name}`);
  }
  const imgChoice = await ask(rl, 'Add image provider? (number or Enter to skip)');
  if (imgChoice) {
    const idx = parseInt(imgChoice) - 1;
    if (idx >= 0 && idx < IMAGE_PROVIDERS.length) {
      const provider = IMAGE_PROVIDERS[idx];
      const apiKey = await ask(rl, `  ${provider.keyHint}`);
      if (apiKey) {
        // Remove existing same provider if any
        const filtered = generators.filter(g => g.provider !== provider.id);
        filtered.push({ provider: provider.id, apiKey });
        generators.length = 0;
        generators.push(...filtered);
        console.log(`  ✓ ${provider.name} configured\n`);
      }
    }
  }

  // Video providers
  console.log('\nVideo Generation:');
  for (let i = 0; i < VIDEO_PROVIDERS.length; i++) {
    console.log(`  ${i + 1}) ${VIDEO_PROVIDERS[i].name}`);
  }
  const vidChoice = await ask(rl, 'Add video provider? (number or Enter to skip)');
  if (vidChoice) {
    const idx = parseInt(vidChoice) - 1;
    if (idx >= 0 && idx < VIDEO_PROVIDERS.length) {
      const provider = VIDEO_PROVIDERS[idx];
      const apiKey = await ask(rl, `  ${provider.keyHint}`);
      if (apiKey) {
        const filtered = generators.filter(g => g.provider !== provider.id);
        filtered.push({ provider: provider.id, apiKey });
        generators.length = 0;
        generators.push(...filtered);
        console.log(`  ✓ ${provider.name} configured\n`);
      }
    }
  }

  // Audio providers
  console.log('\nAudio/Music Generation:');
  for (let i = 0; i < AUDIO_PROVIDERS.length; i++) {
    console.log(`  ${i + 1}) ${AUDIO_PROVIDERS[i].name}`);
  }
  const audChoice = await ask(rl, 'Add audio provider? (number or Enter to skip)');
  if (audChoice) {
    const idx = parseInt(audChoice) - 1;
    if (idx >= 0 && idx < AUDIO_PROVIDERS.length) {
      const provider = AUDIO_PROVIDERS[idx];
      const apiKey = await ask(rl, `  ${provider.keyHint}`);
      if (apiKey) {
        const filtered = generators.filter(g => g.provider !== provider.id);
        filtered.push({ provider: provider.id, apiKey });
        generators.length = 0;
        generators.push(...filtered);
        console.log(`  ✓ ${provider.name} configured\n`);
      }
    }
  }

  (config as any).mediaGenerators = generators;
  saveConfig(config);
  console.log(`\n✓ ${generators.length} media provider(s) configured.`);
  console.log('Restart daemon to activate: beecork stop && beecork start\n');
  rl.close();
}

export function mediaList(): void {
  const { getConfig } = require('../config.js');
  const config = getConfig();
  const generators = (config as any).mediaGenerators || [];
  if (generators.length === 0) {
    console.log('No media generators configured. Run: beecork media');
    return;
  }
  console.log(`\n${generators.length} media provider(s):\n`);
  for (const g of generators) {
    console.log(`  ${g.provider}${g.model ? ` (${g.model})` : ''} — API key: ${g.apiKey.slice(0, 8)}...`);
  }
  console.log('');
}
