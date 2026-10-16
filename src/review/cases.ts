import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';

export interface ReviewCase {
  id: string;
  kind: 'bug' | 'control';
  repo: string;
  sha: string;
  mergedAt?: string;
  subject?: string;
  evidence: { fixShas?: string[]; kind?: string; links?: string[]; note?: string };
}
export interface Finding {
  file: string;
  line: number | null;
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  title: string;
  explanation: string;
}
export interface ReviewOutput {
  verdict: 'approve' | 'request_changes';
  summary: string;
  findings: Finding[];
}

export const casesDir = () => resolve(process.env.REVIEW_CASES_DIR || join(config.data, 'cases'));
export const trustedDir = () => join(config.data, 'trusted');
export function loadSelection(path = join(config.root, 'benchmarks', 'selection.json')) {
  return JSON.parse(readFileSync(path, 'utf8')) as { version: string; cases: ReviewCase[] };
}

const severities = ['blocker', 'major', 'minor', 'nit'];
// Accepts a bare object or one wrapped in prose/code fences; returns null when nothing valid is found.
export function parseReview(text: string): ReviewOutput | null {
  const fenced = text
    .match(/```(?:json)?\s*([\s\S]*?)```/g)
    ?.map((b) => b.replace(/```(?:json)?/g, ''));
  const start = text.indexOf('{'),
    end = text.lastIndexOf('}');
  const attempts = [
    ...(fenced ?? []).reverse(),
    start >= 0 && end > start ? text.slice(start, end + 1) : '',
  ];
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate.trim());
      if (
        !['approve', 'request_changes'].includes(value?.verdict) ||
        !Array.isArray(value.findings)
      )
        continue;
      return {
        verdict: value.verdict,
        summary: String(value.summary ?? ''),
        findings: value.findings.map((f: Record<string, unknown>) => ({
          file: String(f.file ?? ''),
          line: Number.isFinite(Number(f.line)) && f.line !== null ? Number(f.line) : null,
          severity: severities.includes(String(f.severity))
            ? (f.severity as Finding['severity'])
            : 'minor',
          title: String(f.title ?? ''),
          explanation: String(f.explanation ?? ''),
        })),
      };
    } catch {
      /* Try the next candidate block. */
    }
  }
  return null;
}
