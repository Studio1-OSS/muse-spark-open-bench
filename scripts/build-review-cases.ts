// Materializes PR-review cases: the tree at the merged commit (no .git), its diff, and the PR text.
// Ground truth (later fix/revert commits) goes to the trusted directory, never into a case folder.
// Usage: node --import tsx scripts/build-review-cases.ts REPOS_DIR [CASE_IDS...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { casesDir, trustedDir, type ReviewCase } from '../src/review/cases.js';
import { hash } from '../src/domain.js';

const [reposDir, ...only] = process.argv.slice(2);
if (!reposDir) throw new Error('Usage: build-review-cases.ts REPOS_DIR [CASE_IDS...]');
const selection = JSON.parse(readFileSync('benchmarks/selection.json', 'utf8')) as {
  cases: ReviewCase[];
};
const git = (repo: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'filter.lfs.process=',
      '-c',
      'filter.lfs.smudge=cat',
      '-c',
      'filter.lfs.required=false',
      '-C',
      repo,
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 256 << 20 },
  );

for (const c of selection.cases) {
  if (only.length && !only.includes(c.id)) continue;
  const repo = join(reposDir, c.repo.replace('/', '_'));
  const dir = join(casesDir(), c.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'tree'), { recursive: true });
  execFileSync(
    'bash',
    [
      '-c',
      'git -c filter.lfs.process= -c filter.lfs.smudge=cat -c filter.lfs.required=false -C "$0" archive "$1" | tar -x -C "$2"',
      repo,
      c.sha,
      join(dir, 'tree'),
    ],
    {
      maxBuffer: 1 << 30,
    },
  );
  if (existsSync(join(dir, 'tree', '.git'))) throw new Error(`${c.id}: .git leaked into tree`);
  const diff = git(repo, 'show', '--format=', '-M', '--no-color', c.sha);
  const [subject, ...body] = git(repo, 'show', '-s', '--format=%B', c.sha).trimEnd().split('\n');
  const pr = {
    repo: c.repo,
    title: subject,
    description: body.join('\n').trim(),
    parent: git(repo, 'rev-parse', `${c.sha}^`).trim(),
    head: c.sha,
  };
  writeFileSync(join(dir, 'pr.diff'), diff);
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr, null, 2));
  writeFileSync(
    join(dir, 'case.json'),
    JSON.stringify({ id: c.id, diffHash: hash(diff), prHash: hash(pr) }, null, 2),
  );
  if (c.kind === 'bug') {
    mkdirSync(trustedDir(), { recursive: true });
    const fixes = (c.evidence.fixShas ?? []).map((sha) => ({
      sha,
      message: git(repo, 'show', '-s', '--format=%B', sha),
      diff: git(repo, 'show', '--format=', '--no-color', sha),
    }));
    writeFileSync(join(trustedDir(), `${c.id}.json`), JSON.stringify({ ...c, fixes }, null, 2));
  }
  console.log(`${c.id}: ${diff.split('\n').length} diff lines`);
}
