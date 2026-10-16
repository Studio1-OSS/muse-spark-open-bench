// Clean-PR finding. Muse: the fix makes class-method comments consistent across parsers but leaves out Babel's
// ClassPrivateMethod, so `#foo() // c {}` still formats differently with babel than with acorn/espree.
import { execSync, spawnSync } from 'node:child_process';
const src = process.argv[2];
execSync('corepack yarn install --immutable', { cwd: src, stdio: 'ignore', env: { ...process.env, YARN_ENABLE_TELEMETRY: '0' } });
const input = 'class A {\n  #foo() // c\n  {}\n}\n';
const format = (parser) => spawnSync(process.execPath, ['bin/prettier.cjs', '--parser', parser], { cwd: src, input, encoding: 'utf8' }).stdout;
const babel = format('babel'), acorn = format('acorn');
if (babel !== acorn) {
  console.log('BUG: babel and acorn disagree:', JSON.stringify(babel), 'vs', JSON.stringify(acorn));
  process.exit(1);
}
console.log('OK: both parsers print', JSON.stringify(babel));
