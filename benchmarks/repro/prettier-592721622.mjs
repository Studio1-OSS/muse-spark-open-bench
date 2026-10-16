// Muse: isLineBreakAmbiguous reads previous.kind / next.kind without optional chaining, so a line break
// at the edge of a text node next to CJK text throws a TypeError. Input and proseWrap: "always" match the regression test added in prettier#20257.
import { execSync, spawnSync } from 'node:child_process';
const src = process.argv[2];
execSync('corepack yarn install --immutable', { cwd: src, stdio: 'ignore', env: { ...process.env, YARN_ENABLE_TELEMETRY: '0' } });
const input = '**プリティア**\nで\n**フォーマット**\n';
const r = spawnSync(process.execPath, ['bin/prettier.cjs', '--parser', 'markdown', '--prose-wrap', 'always'], { cwd: src, input, encoding: 'utf8' });
if (r.status !== 0) {
  console.log('BUG:', (r.stderr || r.stdout).split('\n').find((l) => /Error/.test(l)) ?? r.stderr.slice(0, 300));
  process.exit(1);
}
console.log('OK: formatted ->', JSON.stringify(r.stdout));
