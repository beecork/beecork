import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../util/logger.js';
import type { MediaGenerator } from './types.js';

const MEDIA_PREFIX = 'beecork-media-';

/**
 * Discover and load community media generator packages from node_modules.
 * Convention: packages named `beecork-media-<name>` must export a default
 * class implementing the MediaGenerator interface.
 */
export async function loadCommunityGenerators(apiKeys?: Record<string, string>): Promise<MediaGenerator[]> {
  const generators: MediaGenerator[] = [];
  const searchPaths = [path.join(process.cwd(), 'node_modules')];

  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue;
    try {
      for (const dir of fs.readdirSync(searchPath)) {
        if (!dir.startsWith(MEDIA_PREFIX)) continue;
        try {
          const pkgPath = path.join(searchPath, dir);
          const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf-8'));
          const entryPath = path.join(pkgPath, pkgJson.main || 'index.js');
          if (!fs.existsSync(entryPath)) continue;
          const module = await import(entryPath);
          const GeneratorClass = module.default || module[Object.keys(module)[0]];
          if (!GeneratorClass || typeof GeneratorClass !== 'function') continue;
          const name = dir.slice(MEDIA_PREFIX.length);
          const instance = new GeneratorClass(apiKeys?.[name]) as MediaGenerator;
          if (!instance.id || !instance.name || typeof instance.generate !== 'function') continue;
          generators.push(instance);
          logger.info(`Community media generator loaded: ${instance.name} (${instance.id})`);
        } catch (err) {
          logger.warn(`Failed to load community generator ${dir}:`, err);
        }
      }
    } catch {}
  }
  return generators;
}
