// Serves site/ locally so the page and its raw-data links work like they do on Vercel.
// Usage: npm run site && npm run preview   (then open http://localhost:4320)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'site');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
};
const port = Number(process.env.PORT ?? 4320);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
    /^([/\\])+/,
    '',
  );
  const file = join(root, path === '' ? 'index.html' : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    res
      .writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Serving site/ on http://localhost:${port}`));
