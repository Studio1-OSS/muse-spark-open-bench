// Muse: when a template expression's root is a TypeScript node, processExpression drops the text before the
// first identifier and after the last one, so `!foo as boolean` compiles to `_ctx.foo` without the `!`,
// and `data[key] as any` loses its closing bracket (vuejs/core#14060). Runs inside Vue's own vitest setup.
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const src = process.argv[2];
execSync('pnpm install --frozen-lockfile', { cwd: src, stdio: 'ignore' });
writeFileSync(join(src, 'packages/compiler-core/__tests__/muse-repro.spec.ts'), `
import { baseCompile } from '../src'
test('TS expressions keep their operators and brackets', () => {
  const { code } = baseCompile('<p :a="!foo as boolean" :b="(data[key]) as any"/>', { prefixIdentifiers: true, expressionPlugins: ['typescript'] })
  console.log(code)
  expect(code).toMatch(/!_ctx\\.foo/)
  expect(code).toMatch(/_ctx\\.data\\[_ctx\\.key\\]/)
})
`);
const r = spawnSync('pnpm', ['vitest', 'run', 'packages/compiler-core/__tests__/muse-repro.spec.ts'], { cwd: src, encoding: 'utf8', env: { ...process.env, CI: '1' } });
const out = r.stdout + r.stderr;
if (r.status !== 0) {
  console.log('BUG:', (out.match(/AssertionError[^\n]*|Expected[^\n]*|Received[^\n]*/g) ?? [out.slice(-400)]).slice(0, 3).join(' | '));
  process.exit(1);
}
console.log('OK:', (out.match(/Tests\s+\d+ passed[^\n]*/) ?? ['passed'])[0]);
