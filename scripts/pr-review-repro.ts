// Runs each reproduction in benchmarks/repro/manifest.json against the merged commit and the
// real fix commit, and records what actually happened in results/repro/<case>.json.
// Usage: node --import tsx scripts/pr-review-repro.ts REPOS_DIR [CASE_IDS...]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { casesDir } from '../src/review/cases.js';

// kind 'control': a finding on a clean PR. There is no fix commit, so it runs on the merged commit and on today's HEAD.
interface Entry {
  case: string;
  kind?: 'bug' | 'control';
  repo: string;
  runtime: 'python' | 'node';
  script: string;
  claim: string;
  merged: string;
  fix?: string;
  parent?: string;
  setup?: string;
}
const [reposDir, ...only] = process.argv.slice(2);
if (!reposDir) throw new Error('Usage: pr-review-repro.ts REPOS_DIR [CASE_IDS...]');
const manifestPath = resolve('benchmarks/repro/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  python: string[];
  entries: Entry[];
};
const scripts = dirname(manifestPath);
const work = join(dirname(casesDir()), 'repro');
const out = resolve('results/repro');
mkdirSync(out, { recursive: true });
const lfs = [
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.smudge=cat',
  '-c',
  'filter.lfs.required=false',
];

function venv() {
  const dir = join(work, '.venv');
  if (!existsSync(join(dir, 'bin', 'python'))) {
    execFileSync('python3', ['-m', 'venv', dir], { stdio: 'inherit' });
    execFileSync(join(dir, 'bin', 'python'), ['-m', 'pip', 'install', '-q', ...manifest.python], {
      stdio: 'inherit',
    });
  }
  return join(dir, 'bin', 'python');
}
function exportTree(repo: string, sha: string, dest: string) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync(
    'bash',
    ['-c', 'git "${@:4}" -C "$0" archive "$1" | tar -x -C "$2"', repo, sha, dest, '', ...lfs],
    { maxBuffer: 1 << 30 },
  );
}
const tail = (s: string) => s.split('\n').slice(-25).join('\n').trim();

for (const e of manifest.entries) {
  if (only.length && !only.includes(e.case)) continue;
  const repo = join(reposDir, e.repo.replace('/', '_'));
  const runs: Record<string, unknown> = {};
  const rev = (r: string) =>
    execFileSync('git', ['-C', repo, 'rev-parse', r], { encoding: 'utf8' }).trim();
  const parent = e.parent ?? rev(`${e.merged}^`);
  const control = e.kind === 'control';
  const labels = control
    ? (['parent', 'merged', 'head'] as const)
    : (['parent', 'merged', 'fix'] as const);
  for (const label of labels) {
    const sha =
      label === 'parent'
        ? parent
        : label === 'head'
          ? rev('HEAD')
          : label === 'merged'
            ? rev(e.merged)
            : e.fix!;
    const src = join(work, e.case, label);
    exportTree(repo, sha, src);
    if (e.setup)
      execFileSync('bash', ['-c', e.setup], { cwd: src, stdio: 'inherit', timeout: 1800000 });
    const script = join(scripts, e.script);
    mkdirSync(join(work, '.home'), { recursive: true });
    const [cmd, args] =
      e.runtime === 'python'
        ? [
            venv(),
            [
              '-I',
              '-c',
              `import sys, runpy; sys.path[:0] = [${JSON.stringify(src)}, ${JSON.stringify(scripts)}]; runpy.run_path(${JSON.stringify(script)}, run_name="__main__")`,
            ],
          ]
        : [process.execPath, [script, src]];
    const started = Date.now();
    const r = spawnSync(cmd, args, {
      cwd: src,
      encoding: 'utf8', // Repository code never sees the provider key or other secrets: only PATH and a scratch HOME.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: e.runtime === 'python' ? src : join(work, '.home'),
        CI: '1',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      },
      timeout: 1500000,
    });
    runs[label] = {
      sha,
      exitCode: r.status,
      ms: Date.now() - started,
      stdout: tail(r.stdout ?? ''),
      stderr: tail(r.stderr ?? ''),
    };
  }
  const merged = runs.merged as { exitCode: number };
  const before = runs.parent as { exitCode: number };
  const fix = (runs.fix ?? runs.head) as { exitCode: number };
  // Bug PR: fails on merged and passes on the maintainers' fix. Clean-PR finding: fails on merged (and still on HEAD).
  const reproduced = control ? false : merged.exitCode !== 0 && fix.exitCode === 0;
  const confirmed = control ? merged.exitCode !== 0 : reproduced;
  const stillPresent = control ? fix.exitCode !== 0 : false;
  // Introduced: the same check passed on the commit just before this PR.
  const introduced = !control && reproduced && before.exitCode === 0;
  const record = {
    case: e.case,
    kind: e.kind ?? 'bug',
    repo: e.repo,
    claim: e.claim,
    script: `benchmarks/repro/${e.script}`,
    reproduced,
    confirmed,
    stillPresent,
    introduced,
    at: new Date().toISOString(),
    runs,
  };
  writeFileSync(join(out, `${e.case}.json`), JSON.stringify(record, null, 2));
  console.log(
    `${e.case}: ${confirmed ? (control ? 'CONFIRMED' : 'REPRODUCED') : 'not reproduced'}${introduced ? ', introduced by this PR' : ''}${stillPresent ? ', still present at HEAD' : ''} (before ${before.exitCode}, merged ${merged.exitCode}, ${control ? 'head' : 'fix'} ${fix.exitCode})`,
  );
}
