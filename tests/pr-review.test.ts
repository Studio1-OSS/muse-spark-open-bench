import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confine } from '../src/review/tools.js';
import { parseReview, loadSelection, casesDir } from '../src/review/cases.js';

describe('PR review harness', () => {
  it('confines paths to the case tree, including symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'review-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'x');
    symlinkSync(tmpdir(), join(root, 'escape'));
    expect(confine(root, 'src/a.ts')).toMatch(/src\/a\.ts$/);
    expect(() => confine(root, '../etc/passwd')).toThrow();
    expect(() => confine(root, '/etc/passwd')).toThrow();
    expect(() => confine(root, 'escape')).toThrow();
  });
  it('parses bare, fenced, and prose-wrapped review JSON', () => {
    const body =
      '{"verdict":"request_changes","summary":"s","findings":[{"file":"a.py","line":"3","severity":"major","title":"t","explanation":"e"}]}';
    for (const text of [
      body,
      '```json\n' + body + '\n```',
      'Here is my review:\n' + body + '\nThanks',
    ]) {
      const r = parseReview(text)!;
      expect(r.verdict).toBe('request_changes');
      expect(r.findings[0]).toMatchObject({ file: 'a.py', line: 3, severity: 'major' });
    }
    expect(parseReview('LGTM')).toBeNull();
    expect(parseReview('{"verdict":"maybe","findings":[]}')).toBeNull();
    expect(
      parseReview('{"verdict":"approve","findings":[{"severity":"critical"}]}')!.findings[0]
        .severity,
    ).toBe('minor');
  });
  it('selection is frozen with 25 bug PRs and 25 clean PRs', () => {
    const s = loadSelection();
    expect(s.cases.filter((c) => c.kind === 'bug')).toHaveLength(25);
    expect(s.cases.filter((c) => c.kind === 'control')).toHaveLength(25);
    expect(new Set(s.cases.map((c) => c.id)).size).toBe(50);
  });
  it.runIf(!!process.env.REVIEW_CASES_DIR && existsSync(process.env.REVIEW_CASES_DIR ?? ''))(
    'built case folders contain no git history or ground truth',
    () => {
      for (const id of readdirSync(casesDir())) {
        expect(existsSync(join(casesDir(), id, 'tree', '.git'))).toBe(false);
        expect(readdirSync(join(casesDir(), id)).sort()).toEqual([
          'case.json',
          'pr.diff',
          'pr.json',
          'tree',
        ]);
      }
    },
  );
});
