// Lists PR-review candidates: merged commits that a later revert or regression fix names as the cause.
// With --controls, lists clean PRs instead: merged fixes that nothing later references and whose added
// source lines are still at least 90% unchanged at HEAD (git blame).
// Usage: node --import tsx scripts/mine-reviews.ts REPOS_DIR [SINCE] > candidates.json
//        node --import tsx scripts/mine-reviews.ts --controls REPOS_DIR COUNT > controls.json
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const controlsMode = process.argv[2] === '--controls';
const [reposDir, since = '2025-06-01'] = process.argv.slice(controlsMode ? 3 : 2);
if (!reposDir) throw new Error('Usage: mine-reviews.ts [--controls] REPOS_DIR [SINCE|COUNT]');
const git = (repo: string, ...args: string[]) =>
  execFileSync('git', [...gitCfg, '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const gitCfg = [
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.smudge=cat',
  '-c',
  'filter.lfs.required=false',
];
const tryGit = (repo: string, ...args: string[]) => {
  try {
    return git(repo, ...args);
  } catch {
    return '';
  }
};
const FIX = String.raw`regression (from|in|introduced)|introduced (in|by)|caused by #[0-9]+|broke(n)? (in|by)`;

function stat(repo: string, sha: string) {
  const out = tryGit(repo, 'show', '--format=', '--numstat', sha);
  let lines = 0,
    files = 0;
  for (const row of out.trim().split('\n').filter(Boolean)) {
    const [a, d] = row.split('\t');
    files++;
    lines += (Number(a) || 0) + (Number(d) || 0);
  }
  return { files, lines };
}
function bySubjectPr(repo: string, pr: string) {
  return tryGit(repo, 'log', '--format=%H', '-F', `--grep=(#${pr})`, '-n', '1').trim();
}
function originFor(repo: string, message: string) {
  const sha = message.match(/This reverts commit ([0-9a-f]{40})/)?.[1];
  if (sha) return sha;
  const regression = message.match(
    /(?:Regression|regression|introduced|caused|broken?)\s+(?:in|by|from)\s+([0-9a-f]{7,40})\b/,
  )?.[1];
  if (regression)
    return tryGit(repo, 'rev-parse', '--verify', '-q', `${regression}^{commit}`).trim();
  const pr = message.match(
    /(?:Revert "[^\n]*\(#(\d+)\)"|(?:regression|introduced|caused|broken?)\s+(?:in|by|from)\s+(?:[\w/-]+)?#(\d+))/i,
  );
  const n = pr?.[1] ?? pr?.[2];
  return n ? bySubjectPr(repo, n) : '';
}

const SOURCE_EXCLUDE =
  /(^|\/)(tests?|__tests__|spec|docs?|examples?|fixtures?|\.changeset|releases)(\/|$)|\.(md|mdx|txt|snap|json|ya?ml|lock)$|test|spec/i;
const NOT_CODE =
  /revert|regression|\bdeps?\b|bump|docs?\b|typo|chore|release|\bci\b|lint|readme|changelog/i;

function survival(repo: string, sha: string) {
  let added = 0,
    kept = 0;
  for (const row of tryGit(repo, 'show', '--format=', '--numstat', '--no-renames', sha)
    .trim()
    .split('\n')
    .filter(Boolean)) {
    const [a, , file] = row.split('\t');
    if (!Number(a) || SOURCE_EXCLUDE.test(file)) continue;
    added += Number(a);
    const blame = tryGit(repo, 'blame', '--line-porcelain', 'HEAD', '--', file);
    kept += blame.split('\n').filter((l) => l.startsWith(sha + ' ')).length;
  }
  return { added, kept, ratio: added ? kept / added : 0 };
}

function controls(count: number) {
  const selection = JSON.parse(readFileSync('benchmarks/selection.json', 'utf8')) as {
    cases: { repo: string; sha: string; kind: string }[];
  };
  const taken = new Set(selection.cases.map((c) => c.sha));
  const repos = [
    ...new Set(selection.cases.filter((c) => c.kind === 'bug').map((c) => c.repo)),
  ].sort();
  const pools = repos.map((full) => {
    const repo = join(reposDir, full.replace('/', '_'));
    const log = git(
      repo,
      'log',
      '--since=2025-06-01',
      '--until=2026-04-30',
      '--no-merges',
      '-E',
      '-i',
      '--grep=^(fix|fixed #)',
      '--format=%H%x00%cI%x00%s',
    );
    const later = git(repo, 'log', '--since=2025-06-01', '--format=%H%x00%B%x1e');
    const rows = log
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\x00'))
      .filter(([sha, , subject]) => !taken.has(sha) && !NOT_CODE.test(subject))
      .sort((a, b) =>
        createHash('sha256')
          .update(a[0])
          .digest('hex')
          .localeCompare(createHash('sha256').update(b[0]).digest('hex')),
      );
    return { full, repo, rows, later };
  });
  const picked: Record<string, unknown>[] = [];
  const rejected: Record<string, unknown>[] = [];
  const perRepo = Math.ceil(count / repos.length);
  for (const { full, repo, rows, later } of pools) {
    let n = 0;
    for (const [sha, date, subject] of rows) {
      if (n >= perRepo || picked.length >= count) break;
      const size = stat(repo, sha);
      if (size.lines < 30 || size.lines > 400) continue;
      const pr = subject.match(/\(#(\d+)\)\s*$/)?.[1] ?? subject.match(/^Fixed #(\d+)/)?.[1];
      const refs = later.split('\x1e').filter((r) => {
        const [h, body] = r.trim().split('\x00');
        return (
          h &&
          h !== sha &&
          (body?.includes(sha.slice(0, 7)) || (pr && new RegExp(`#${pr}\\b`).test(body ?? '')))
        );
      });
      if (refs.length) {
        rejected.push({ repo: full, sha, subject, reason: 'referenced later' });
        continue;
      }
      const s = survival(repo, sha);
      if (s.added < 10 || s.ratio < 0.9) {
        rejected.push({ repo: full, sha, subject, reason: `survival ${s.kept}/${s.added}` });
        continue;
      }
      picked.push({ repo: full, sha, mergedAt: date, subject, size, survival: s });
      n++;
    }
  }
  return {
    rule: 'fix commits 2025-06..2026-04, 30-400 changed lines, no later commit mentions the SHA or PR/ticket number, >=90% of added source lines unchanged at HEAD (git blame)',
    picked,
    rejected,
  };
}

if (controlsMode) {
  console.log(JSON.stringify(controls(Number(since) || 19), null, 2));
  process.exit(0);
}

const candidates = [];
for (const name of readdirSync(reposDir).sort()) {
  const repo = join(reposDir, name);
  const log = git(
    repo,
    'log',
    `--since=${since}`,
    '-E',
    '-i',
    `--grep=^Revert "`,
    `--grep=${FIX}`,
    '--format=%H%x00%cI%x00%B%x1e',
  );
  for (const record of log
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)) {
    const [fixSha, fixDate, message] = record.split('\x00');
    const origin = originFor(repo, message);
    if (!origin) continue;
    const meta = tryGit(repo, 'show', '-s', '--format=%cI%x00%P%x00%s', origin).trim();
    if (!meta) continue;
    const [originDate, parents, subject] = meta.split('\x00');
    if (parents.split(' ').length !== 1) continue;
    candidates.push({
      repo: name.replace('_', '/'),
      kind: message.startsWith('Revert "') ? 'revert' : 'regression-fix',
      originSha: origin,
      originDate,
      originSubject: subject,
      originSize: stat(repo, origin),
      fixSha,
      fixDate,
      fixMessage: message.slice(0, 1500),
      fixSize: stat(repo, fixSha),
    });
  }
}
console.log(JSON.stringify(candidates, null, 2));
