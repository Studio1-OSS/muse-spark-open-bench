// Builds results/summary.json, the report page (report.html) and the public site (site/)
// from the exported runs, grades, executed reproductions and memory probe.
// Usage: node --import tsx scripts/pr-review-report.ts [--og]   (SITE_URL=https://… sets absolute share URLs)
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { wilson } from '../src/accounting.js';
import type { ReviewCase } from '../src/review/cases.js';
import type { ReviewRecord } from '../src/review/runner.js';
import type { ProbeRecord } from '../src/review/probe.js';

const dir = 'results';
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const jsonl = <T>(name: string) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T)
    : [];
const selection = read('cases.json') as {
  version: string;
  cases: (ReviewCase & { size?: { lines: number }; rule?: string })[];
};
const runs = read('runs.json') as {
  runId: string;
  caseId: string;
  seconds: number;
  tools: number;
  cost: string;
  input: number;
  output: number;
  cached: number;
  calls: number;
}[];
const usage = read('usage.json');
const reviews = jsonl<ReviewRecord>('reviews.jsonl');
const grades = JSON.parse(readFileSync('benchmarks/grades.json', 'utf8')) as {
  cases: Record<
    string,
    {
      grade: string;
      broke: string;
      match: number | null;
      rationale: string;
      falseAlarms?: number;
      plausible?: number;
      confirmed?: number;
    }
  >;
  highlights: { id: string; label?: string; finding?: number }[];
};
const manifest = JSON.parse(readFileSync('benchmarks/repro/manifest.json', 'utf8')) as {
  notExecuted: { case: string; reason: string }[];
};
const reproDir = join(dir, 'repro');
type Repro = {
  case: string;
  kind?: string;
  claim: string;
  script: string;
  reproduced: boolean;
  confirmed?: boolean;
  stillPresent?: boolean;
  introduced: boolean;
  runs: Record<string, { sha: string; exitCode: number; stdout: string; stderr: string }>;
};
const repros: Repro[] = existsSync(reproDir)
  ? readdirSync(reproDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(reproDir, f), 'utf8')))
  : [];
const probes = jsonl<ProbeRecord>('probe.jsonl');
const probeUsage = existsSync(join(dir, 'probe-usage.json')) ? read('probe-usage.json') : null;
// Latest successful probe answer per case (failed attempts stay in probe.jsonl).
const probeByCase = new Map<string, ProbeRecord>();
for (const p of probes) if (!p.error) probeByCase.set(p.caseId, p);

// Last meaningful output line, without terminal colour codes.
const lastLine = (raw: string) => {
  const s = raw.replace(/\u001b?\[[0-9;]*m/g, '');
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.reverse().find((l) => /BUG|OK|Error/.test(l)) ?? lines[0] ?? '';
};
const cases = selection.cases.map((c) => {
  const g = grades.cases[c.id];
  if (!g) throw new Error(`Missing grade for ${c.id}`);
  const run = runs.find((r) => r.caseId === c.id);
  if (!run) throw new Error(`Missing run for ${c.id}`);
  const review = reviews.find((r) => r.caseId === c.id);
  const repro = repros.find((r) => r.case === c.id);
  const match = g.match !== null && review?.review ? review.review.findings[g.match] : null;
  return {
    id: c.id,
    kind: c.kind,
    repo: c.repo,
    sha: c.sha,
    size: c.size,
    links: c.evidence.links ?? [],
    rule: c.rule ?? null,
    title: c.subject ?? c.id,
    grade: c.kind === 'control' ? 'control' : g.grade,
    broke: g.broke,
    match: g.match,
    rationale: g.rationale,
    falseAlarms: g.falseAlarms ?? 0,
    plausible: g.plausible ?? 0,
    confirmed: g.confirmed ?? 0,
    strict:
      c.kind === 'bug' &&
      g.grade === 'caught' &&
      !!match &&
      ['blocker', 'major'].includes(match.severity) &&
      review?.review?.verdict === 'request_changes',
    review: review?.review ?? null,
    cost: Number(run.cost),
    seconds: run.seconds,
    tools: run.tools,
    input: run.input,
    output: run.output,
    calls: run.calls,
    repro: repro
      ? {
          reproduced: repro.reproduced,
          introduced: repro.introduced,
          claim: repro.claim,
          script: repro.script,
          before: {
            exit: repro.runs.parent?.exitCode,
            line: lastLine(
              (repro.runs.parent?.stdout ?? '') + '\n' + (repro.runs.parent?.stderr ?? ''),
            ),
          },
          merged: {
            exit: repro.runs.merged.exitCode,
            line: lastLine(repro.runs.merged.stdout + '\n' + repro.runs.merged.stderr),
          },
          fix: (() => {
            const f = repro.runs.fix ?? repro.runs.head;
            return {
              exit: f.exitCode,
              line: lastLine(f.stdout + '\n' + f.stderr),
              sha: f.sha,
              head: !repro.runs.fix,
            };
          })(),
          kind: repro.kind ?? 'bug',
          confirmed: repro.confirmed ?? repro.reproduced,
          stillPresent: !!repro.stillPresent,
        }
      : null,
    notExecuted: manifest.notExecuted.find((n) => n.case === c.id)?.reason ?? null,
    probe: probeByCase.get(c.id)?.answer ?? null,
  };
});
const bugs = cases.filter((c) => c.kind === 'bug');
const controls = cases.filter((c) => c.kind === 'control');
const count = (list: typeof cases, grade: string) => list.filter((c) => c.grade === grade).length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n: number) => n.toLocaleString('en-US');
const group = (name: string, detail: string, list: typeof cases) => ({
  name,
  detail,
  total: list.length,
  caught: count(list, 'caught'),
  partial: count(list, 'partial'),
  missed: count(list, 'missed'),
});
const python = bugs.filter((c) => c.repo === 'django/django');
const js = bugs.filter((c) => c.repo !== 'django/django');
const caught = bugs.filter((c) => c.grade === 'caught');
const reviewCost = Number(usage.cost),
  probeCost = Number(probeUsage?.cost ?? 0);
const summary = {
  date: '2026-10-16',
  model: usage.model,
  benchmarkId: usage.benchmarkId,
  benchmarkIds: usage.benchmarkIds ?? [usage.benchmarkId],
  promptHash: usage.promptHash,
  bugCases: bugs.length,
  controlCases: controls.length,
  repos: new Set(cases.map((c) => c.repo)).size,
  caught: caught.length,
  partial: count(bugs, 'partial'),
  missed: count(bugs, 'missed'),
  catchRate: caught.length / bugs.length,
  interval: wilson(caught.length, bugs.length)!,
  strictCaught: bugs.filter((c) => c.strict).length,
  strictInterval: wilson(bugs.filter((c) => c.strict).length, bugs.length)!,
  reproduced: caught.filter((c) => c.repro?.reproduced).length,
  introducedByPr: caught.filter((c) => c.repro?.introduced).length,
  reproNotExecuted: caught.filter((c) => !c.repro?.reproduced).length,
  blocked: bugs.filter((c) => c.review?.verdict === 'request_changes').length,
  controlApproved: controls.filter((c) => c.review?.verdict === 'approve').length,
  controlsWithFalseAlarm: controls.filter((c) => c.falseAlarms > 0).length,
  falseAlarms: controls.reduce((s, c) => s + c.falseAlarms, 0),
  plausibleOnControls: controls.reduce((s, c) => s + c.plausible, 0),
  confirmedOnControls: controls.reduce((s, c) => s + c.confirmed, 0),
  probe: {
    asked: bugs.length,
    answered: probeByCase.size,
    unknown: [...probeByCase.values()].filter((p) => p.unknown).length,
    attempts: probes.length,
    cost: probeCost,
  },
  medianSeconds: median(cases.map((c) => c.seconds)),
  costPerReview: reviewCost / cases.length,
  totalCost: reviewCost,
  totalSpend: reviewCost + probeCost,
  costPerCatch: reviewCost / Math.max(1, caught.length),
  tokens: {
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cached: usage.cached,
    calls: usage.calls,
  },
  usageComplete: usage.usageComplete,
  costComplete: usage.costComplete,
  byRepo: [...new Set(cases.map((c) => c.repo))]
    .map((repo) => {
      const list = cases.filter((c) => c.repo === repo);
      const b = list.filter((c) => c.kind === 'bug'),
        k = list.filter((c) => c.kind === 'control');
      return {
        repo,
        bug: b.length,
        caught: count(b, 'caught'),
        partial: count(b, 'partial'),
        clean: k.length,
        approved: k.filter((c) => c.review?.verdict === 'approve').length,
      };
    })
    .sort((x, y) => y.bug + y.clean - (x.bug + x.clean) || x.repo.localeCompare(y.repo)),
  groups: [
    group('Django', `Python · ${python.length} PRs`, python),
    group(
      'JS / TS libraries',
      `${new Set(js.map((c) => c.repo)).size} repos · ${js.length} PRs`,
      js,
    ),
  ],
  usageRows: [
    [
      'Wall time per review',
      Math.round(median(cases.map((c) => c.seconds))) + 's',
      Math.round(Math.max(...cases.map((c) => c.seconds))) + 's',
      Math.round(cases.reduce((s, c) => s + c.seconds, 0) / 60) + ' min',
    ],
    [
      'Cost per review',
      '$' + median(cases.map((c) => c.cost)).toFixed(2),
      '$' + Math.max(...cases.map((c) => c.cost)).toFixed(2),
      '$' + reviewCost.toFixed(2),
    ],
    [
      'Model calls',
      String(median(cases.map((c) => c.calls))),
      String(Math.max(...cases.map((c) => c.calls))),
      fmt(usage.calls),
    ],
    [
      'Tool calls',
      String(median(cases.map((c) => c.tools))),
      String(Math.max(...cases.map((c) => c.tools))),
      fmt(cases.reduce((s, c) => s + c.tools, 0)),
    ],
    [
      'Input tokens',
      fmt(median(cases.map((c) => c.input))),
      fmt(Math.max(...cases.map((c) => c.input))),
      fmt(usage.input),
    ],
    [
      'Output tokens',
      fmt(median(cases.map((c) => c.output))),
      fmt(Math.max(...cases.map((c) => c.output))),
      fmt(usage.output),
    ],
  ],
};
const newControls = controls.filter((c) => c.rule);
const method = [
  {
    title: 'Bug PRs',
    text: `${bugs.length} PRs merged between June 2025 and May 2026 that a later commit reverted or named as the cause of a regression ("Regression in <sha>", "regression introduced in #N", a revert citing a bug). Each kept case has a fix commit or issue that states the defect. Reverts for release timing, dependency bumps, or no stated reason were excluded.`,
  },
  {
    title: 'Clean PRs',
    text: `${controls.length} merged fixes from the same repos and period. ${newControls.length ? `${newControls.length} were picked by a mechanical rule: no later commit mentions their SHA or PR number, and at least 90% of the source lines they added are still unchanged today (git blame). ` : ''}The first ${controls.length - newControls.length} only required that no later commit references them. "No known follow-up fix" does not prove a PR is bug-free.`,
  },
  {
    title: 'What Muse saw',
    items: [
      'PR title, the commit message as description, and the full diff.',
      'The repository as it was right after the merge, with no git history.',
      'Three read-only tools: list files, search, read a file range. No code execution.',
      'One prompt for every case, which does not say a bug exists.',
    ],
  },
  {
    title: 'Settings',
    items: [
      `Model ${usage.model} on Nebius Token Factory with provider defaults: no temperature, top-p or reasoning overrides.`,
      'Up to 40 tool steps, 16,384 output tokens per request, one attempt per PR.',
      'One repair turn if the final answer was not valid JSON.',
    ],
  },
  {
    title: 'Grading',
    items: [
      'Caught: a finding names the same defect mechanism as the real fix.',
      'Strict: caught, the matching finding is blocker or major, and the verdict was "request changes".',
      'Partial: right code or symptom, wrong or speculative mechanism. Never counted as caught.',
      'Rubric fixed before the run. Grades are checked by running code wherever the bug can run outside a full app build.',
    ],
  },
  {
    title: 'Limits',
    items: [
      `${cases.length} PRs is a small sample; ${python.length} bug PRs come from Django.`,
      'One attempt per PR, so run-to-run variation is not measured.',
      'Every bug PR here was approved by its maintainers at merge time, so these are defects that got past human review.',
    ],
  },
];
const faq = [
  {
    q: 'Who decided what counts as caught?',
    a: `The rubric was written before the run, and each grade has a written rationale linked to the real fix. On top of that, ${summary.reproduced} of the ${summary.caught} catches were confirmed by running code: the input Muse described fails on the merged commit and passes on the maintainers' fix. The other ${summary.reproNotExecuted} need a full app build to run and are marked as graded only.`,
  },
  {
    q: 'Did Muse just remember these bugs from training?',
    a: `Before any review, Muse was asked about each of the ${summary.bugCases} bug PRs with no code and no tools. It answered "unknown" for ${summary.probe.unknown} of ${summary.probe.answered}. Its catches came from reading the diff and the code, and it never saw any history after the merge.`,
  },
  {
    q: 'Is 12 of 25 generous?',
    a: `Under a strict reading (the matching finding must be blocker or major and the review must request changes) it is ${summary.strictCaught} of ${summary.bugCases}. Partial catches are never added to either number.`,
  },
  {
    q: 'Does it just flag everything?',
    a: `On ${summary.controlCases} clean PRs it approved ${summary.controlApproved} and raised false alarms on ${summary.controlsWithFalseAlarm}. Every clean PR's findings are listed below so you can judge them yourself.`,
  },
  {
    q: 'Can I check this myself?',
    a: 'Yes. Every review, grade, reproduction log and per-request token record is in the raw data below and in the repository, with the commands to rerun it.',
  },
];
writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(dir, 'grades.json'), JSON.stringify(grades, null, 2));
const template = readFileSync('scripts/pr-review-report.template.html', 'utf8');
const data = JSON.stringify({ summary, cases, highlights: grades.highlights, method, faq }).replace(
  /</g,
  '\\u003c',
);
const svg = (f: string) => 'data:image/svg+xml;base64,' + readFileSync(f).toString('base64');
const page = template
  .replace('/*LOGO*/', svg('brand/muse.svg'))
  .replace('/*NEBIUS*/', svg('brand/nebius.svg'))
  .replace('/*DATA*/null', data);
writeFileSync(join(dir, 'report.html'), page);

// Public site: same page as a full HTML document with share tags, plus the raw data it cites.
const site = 'site';
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'data', 'repro'), { recursive: true });
for (const f of [
  'summary.json',
  'grades.json',
  'cases.json',
  'reviews.jsonl',
  'requests.jsonl',
  'runs.json',
  'usage.json',
  'probe.jsonl',
  'probe-usage.json',
])
  if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(site, 'data', f));
for (const r of repros)
  writeFileSync(join(site, 'data', 'repro', `${r.case}.json`), JSON.stringify(r, null, 2));
copyFileSync('benchmarks/RUBRIC.md', join(site, 'data', 'RUBRIC.md'));
const base = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const description = `Muse Spark Open reviewed ${summary.bugCases} real merged PRs that later shipped bugs, plus ${summary.controlCases} clean PRs. It named ${summary.caught} of the ${summary.bugCases} bugs; ${summary.reproduced} catches were confirmed by running code.`;
const headEnd = page.indexOf('</style>') + '</style>'.length;
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="Did Muse catch the bug that actually shipped?">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
${base ? `<meta property="og:url" content="${base}/">\n<meta property="og:image" content="${base}/og.png">` : '<meta property="og:image" content="og.png">'}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${base ? base + '/og.png' : 'og.png'}">
<link rel="icon" href="${svg('brand/muse.svg')}">
<style>html{-webkit-text-size-adjust:100%}body{margin:0}:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}[hidden]{display:none!important}</style>
${page.slice(0, headEnd)}
</head>
<body>
${page.slice(headEnd)}
</body>
</html>
`;
writeFileSync(join(site, 'index.html'), doc);
writeFileSync(
  join(site, 'vercel.json'),
  JSON.stringify(
    {
      cleanUrls: true,
      headers: [
        { source: '/data/(.*)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      ],
    },
    null,
    2,
  ),
);

if (process.argv.includes('--og')) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome' });
  const tab = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  await tab.goto('file://' + join(process.cwd(), site, 'index.html'));
  await tab.waitForTimeout(1200);
  await tab.evaluate(() => {
    document.getElementById('nav')?.remove();
    window.scrollTo(0, 0);
  });
  await tab.screenshot({ path: join(site, 'og.png') });
  await browser.close();
} else if (existsSync(join(dir, 'og.png'))) copyFileSync(join(dir, 'og.png'), join(site, 'og.png'));
if (existsSync(join(site, 'og.png'))) copyFileSync(join(site, 'og.png'), join(dir, 'og.png'));
console.log(
  `caught ${summary.caught}/${summary.bugCases} (strict ${summary.strictCaught}), reproduced ${summary.reproduced}/${summary.caught}, partial ${summary.partial}, controls approved ${summary.controlApproved}/${summary.controlCases}, probe unknown ${summary.probe.unknown}/${summary.probe.answered}, cost $${summary.totalSpend.toFixed(2)}`,
);
