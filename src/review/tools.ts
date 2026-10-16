import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Store } from '../store.js';
import { id } from '../domain.js';

const run = promisify(execFile);

// Resolves a repository-relative path and refuses anything outside the case tree, including via symlinks.
export function confine(root: string, path: string) {
  const base = realpathSync(root);
  const target = resolve(base, path || '.');
  if (target !== base && !target.startsWith(base + sep))
    throw new Error('Path is outside the repository');
  const real = realpathSync(target);
  if (real !== base && !real.startsWith(base + sep))
    throw new Error('Path is outside the repository');
  return real;
}

// Read-only tools: the reviewer browses the merged tree but cannot execute repository code.
export function reviewTools(store: Store, runId: string, root: string) {
  const wrap = async (name: string, args: Record<string, unknown>, fn: () => Promise<unknown>) => {
    const callId = id();
    store.event(runId, 'tool.started', { callId, name, args });
    const start = Date.now();
    try {
      const result = await fn();
      store.event(runId, 'tool.finished', { callId, name, result, durationMs: Date.now() - start });
      return result;
    } catch (error) {
      store.event(runId, 'tool.failed', {
        callId,
        name,
        error: String(error),
        durationMs: Date.now() - start,
      });
      return { error: String(error instanceof Error ? error.message : error) };
    }
  };
  return {
    list_files: createTool({
      id: 'list_files',
      description: 'List entries of a repository directory (directories end with /).',
      inputSchema: z.object({ path: z.string().default('.') }),
      execute: async (a) =>
        wrap('list_files', a, async () => {
          const dir = confine(root, a.path);
          const entries = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.name !== 'node_modules')
            .map((e) => e.name + (e.isDirectory() ? '/' : ''))
            .sort();
          return { entries: entries.slice(0, 300), truncated: entries.length > 300 };
        }),
    }),
    search_repo: createTool({
      id: 'search_repo',
      description:
        'Search repository text for a fixed string; returns up to 150 path:line:text matches.',
      inputSchema: z.object({ query: z.string().min(1).max(300), path: z.string().default('.') }),
      execute: async (a) =>
        wrap('search_repo', a, async () => {
          const dir = confine(root, a.path);
          const result = await run(
            'grep',
            ['-rnIF', '--exclude-dir=node_modules', '--exclude-dir=.git', '--', a.query, dir],
            { maxBuffer: 32 << 20, timeout: 60000 },
          ).catch((e) => ({ stdout: String(e.stdout ?? '') }));
          const lines = result.stdout.split('\n').filter(Boolean);
          return {
            matches: lines.slice(0, 150).map((l) => relative(realpathSync(root), l).slice(0, 400)),
            total: lines.length,
          };
        }),
    }),
    read_file: createTool({
      id: 'read_file',
      description: 'Read a numbered line range (max 400 lines) of a repository file.',
      inputSchema: z.object({
        path: z.string(),
        start: z.number().int().min(1).default(1),
        end: z.number().int().min(1).optional(),
      }),
      execute: async (a) =>
        wrap('read_file', a, async () => {
          const file = confine(root, a.path);
          if (!statSync(file).isFile()) throw new Error('Not a file');
          const lines = readFileSync(file, 'utf8').split('\n');
          const end = Math.min(a.end ?? a.start + 399, a.start + 399, lines.length);
          return {
            path: a.path,
            start: a.start,
            end,
            totalLines: lines.length,
            content: lines
              .slice(a.start - 1, end)
              .map((l, i) => `${a.start + i}: ${l}`)
              .join('\n'),
          };
        }),
    }),
  };
}
export const caseTree = (dir: string) => join(dir, 'tree');
