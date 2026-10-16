// Live terminal output for `npm run bench -- run --watch`: every tool call and model step as it happens.
export const watching = () => process.env.MUSE_WATCH === '1';
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 90 ? s.slice(0, 87) + '...' : s;
};
export function watchTool(name: string, args: Record<string, unknown>) {
  if (!watching()) return;
  const what =
    args.path && args.query ? `"${args.query}" in ${args.path}` : (args.query ?? args.path ?? '');
  const range = args.start ? `:${args.start}${args.end ? '-' + args.end : ''}` : '';
  console.log(`   \x1b[36m${name.padEnd(12)}\x1b[0m ${short(what)}${range}`);
}
export function watchResult(result: unknown) {
  if (!watching() || !result || typeof result !== 'object') return;
  const r = result as Record<string, unknown>;
  const info =
    'content' in r
      ? `${r.end ?? '?'} of ${r.totalLines ?? '?'} lines`
      : 'matches' in r
        ? `${r.total ?? (r.matches as unknown[]).length} matches`
        : 'entries' in r
          ? `${(r.entries as unknown[]).length} entries`
          : 'error' in r
            ? `error: ${short(r.error)}`
            : '';
  if (info) console.log(dim(`                ↳ ${info}`));
}
export function watchStep(step: number, input: number, output: number, cost: string) {
  if (!watching()) return;
  console.log(
    dim(
      `   model call ${step}: ${input.toLocaleString('en-US')} in / ${output.toLocaleString('en-US')} out tokens · running cost $${Number(cost).toFixed(4)}`,
    ),
  );
}
export function watchStart(id: string, title: string, images: number) {
  if (!watching()) return;
  console.log(
    `\n\x1b[1m▶ ${id}\x1b[0m  ${title}${images ? `  (+${images} screenshot${images > 1 ? 's' : ''})` : ''}`,
  );
}
export function watchReview(
  review: { verdict: string; findings: { severity: string; file: string; title: string }[] } | null,
) {
  if (!watching()) return;
  if (!review) return console.log('   \x1b[31mno valid review\x1b[0m');
  console.log(`   \x1b[1mverdict: ${review.verdict}\x1b[0m`);
  for (const f of review.findings) console.log(`   • [${f.severity}] ${f.title}  ${dim(f.file)}`);
}
