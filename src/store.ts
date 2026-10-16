import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.js';
import {
  hash,
  id,
  now,
  type TraceEvent,
  type Artifact,
  type Run,
  type RequestRecord,
} from './domain.js';
export class Store {
  db: DatabaseSync;
  directory: string;
  constructor(directory = config.data) {
    this.directory = resolve(directory);
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'lab.sqlite'));
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(run_id,sequence));`,
    );
    // Evidence lives beside the database, so copied workspaces remain readable.
    for (const artifact of this.all<Artifact>('artifact')) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(artifact.runId) || !/^[a-f0-9]{64}$/.test(artifact.digest))
        throw new Error('Invalid stored artifact location');
      const path = join(this.directory, 'artifacts', artifact.runId, artifact.digest);
      if (artifact.path !== path && existsSync(path)) {
        if (hash(readFileSync(path)) !== artifact.digest)
          throw new Error(`Artifact checksum mismatch: ${artifact.id}`);
        this.put('artifact', { ...artifact, path });
      }
    }
  }
  put<T extends { id: string }>(kind: string, doc: T): T {
    this.db
      .prepare(
        'INSERT INTO documents VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json',
      )
      .run(kind, doc.id, JSON.stringify(doc));
    return doc;
  }
  get<T>(kind: string, key: string): T | undefined {
    const row = this.db
      .prepare('SELECT json FROM documents WHERE kind=? AND id=?')
      .get(kind, key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  all<T>(kind: string): T[] {
    return (
      this.db.prepare('SELECT json FROM documents WHERE kind=? ORDER BY rowid').all(kind) as {
        json: string;
      }[]
    ).map((r) => JSON.parse(r.json));
  }
  event(runId: string, type: string, data: Record<string, unknown> = {}) {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence),0)+1 as seq FROM events WHERE run_id=?')
      .get(runId) as { seq: number };
    const event: TraceEvent = { runId, sequence: row.seq, at: now(), type, data };
    this.db
      .prepare('INSERT INTO events VALUES(?,?,?)')
      .run(runId, event.sequence, JSON.stringify(event));
    return event;
  }
  events(runId: string, after = 0): TraceEvent[] {
    return (
      this.db
        .prepare('SELECT json FROM events WHERE run_id=? AND sequence>? ORDER BY sequence')
        .all(runId, after) as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  updateRun(runId: string, patch: Partial<Run>) {
    const r = this.get<Run>('run', runId);
    if (!r) throw new Error('Run not found');
    const next = { ...r, ...patch };
    this.put('run', next);
    this.event(runId, 'run.updated', { outcome: next.outcome, reason: next.reason ?? null });
    return next;
  }
  artifact(
    runId: string,
    name: string,
    content: string | Uint8Array,
    mime = 'text/plain',
  ): Artifact {
    const digest = hash(content);
    const dir = join(this.directory, 'artifacts', runId);
    mkdirSync(dir, { recursive: true });
    const artifact: Artifact = {
      id: id(),
      runId,
      name,
      mime,
      digest,
      bytes: Buffer.byteLength(content),
      path: join(dir, digest),
      at: now(),
    };
    writeFileSync(artifact.path, content);
    this.put('artifact', artifact);
    this.event(runId, 'artifact.created', {
      id: artifact.id,
      name,
      mime,
      bytes: artifact.bytes,
      digest,
    });
    return artifact;
  }
  artifacts(runId: string) {
    return this.all<Artifact>('artifact').filter((a) => a.runId === runId);
  }
  requests(runId: string) {
    return this.all<RequestRecord>('request').filter((r) => r.runId === runId);
  }
  readArtifact(artifact: Artifact) {
    return readFileSync(artifact.path);
  }
  close() {
    this.db.close();
  }
}
