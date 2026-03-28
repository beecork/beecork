import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { expandHome } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { Project } from './types.js';

/** Scan filesystem for projects (git repos, package.json, etc.) */
export function scanForProjects(scanPaths: string[]): Project[] {
  const projects: Project[] = [];

  for (const scanPath of scanPaths) {
    const expanded = expandHome(scanPath);
    if (!fs.existsSync(expanded)) continue;

    try {
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const dirPath = path.join(expanded, entry.name);

        // Check if this is a project
        if (isProject(dirPath)) {
          projects.push(analyzeProject(dirPath));
          continue;
        }

        // Check one level deeper
        try {
          const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') continue;
            const subPath = path.join(dirPath, sub.name);
            if (isProject(subPath)) {
              projects.push(analyzeProject(subPath));
            }
          }
        } catch { /* permission denied, skip */ }
      }
    } catch { /* permission denied, skip */ }
  }

  logger.info(`Project scanner: found ${projects.length} projects`);
  return projects;
}

function isProject(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, '.git')) ||
    fs.existsSync(path.join(dirPath, 'package.json')) ||
    fs.existsSync(path.join(dirPath, 'Cargo.toml')) ||
    fs.existsSync(path.join(dirPath, 'go.mod')) ||
    fs.existsSync(path.join(dirPath, 'pyproject.toml')) ||
    fs.existsSync(path.join(dirPath, 'requirements.txt')) ||
    fs.existsSync(path.join(dirPath, 'Gemfile')) ||
    fs.existsSync(path.join(dirPath, 'Makefile'))
  );
}

function analyzeProject(dirPath: string): Project {
  const name = path.basename(dirPath);
  const languages: string[] = [];

  if (fs.existsSync(path.join(dirPath, 'package.json'))) languages.push('javascript/typescript');
  if (fs.existsSync(path.join(dirPath, 'Cargo.toml'))) languages.push('rust');
  if (fs.existsSync(path.join(dirPath, 'go.mod'))) languages.push('go');
  if (fs.existsSync(path.join(dirPath, 'pyproject.toml')) || fs.existsSync(path.join(dirPath, 'requirements.txt'))) languages.push('python');
  if (fs.existsSync(path.join(dirPath, 'Gemfile'))) languages.push('ruby');
  if (fs.existsSync(path.join(dirPath, 'Package.swift'))) languages.push('swift');

  let description = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
    description = pkg.description || '';
  } catch { /* no package.json or invalid */ }

  if (!description) {
    try {
      const readme = fs.readFileSync(path.join(dirPath, 'README.md'), 'utf-8');
      // Take first non-empty, non-heading line
      const firstLine = readme.split('\n').find(l => l.trim() && !l.startsWith('#'));
      description = firstLine?.trim().slice(0, 200) || '';
    } catch { /* no readme */ }
  }

  return {
    id: uuidv4(),
    name,
    path: dirPath,
    description,
    languages,
    lastUsed: null,
    tabName: null,
    discoveredVia: 'scan',
    createdAt: new Date().toISOString(),
  };
}
