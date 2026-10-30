/**
 * Durable run store (docs/spec/api.md §2.0): one JSON document per run at
 * `${DATA_DIR:-.data}/runs/<runId>.json`, written temp + fsync + rename
 * through a per-run write queue. Step files live in `runs/<runId>/files/<stepId>/<name>`.
 */
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PipelineRun } from "./types.ts";

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export function dataDir(): string {
  return process.env.DATA_DIR?.trim() || ".data";
}

export function runsDir(): string {
  return join(dataDir(), "runs");
}

export function isRunId(id: string): boolean {
  return RUN_ID.test(id);
}

/** A run file path relative to `files/`: `<stepId>/<name>` segments of `[A-Za-z0-9._-]`. */
export function isFilePath(rel: string): boolean {
  const parts = rel.split("/");
  return parts.length >= 1 && parts.length <= 2 && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}

function runPath(id: string): string {
  if (!isRunId(id)) throw new Error(`Invalid run id: ${JSON.stringify(id)}`);
  return join(runsDir(), `${id}.json`);
}

export function runFilesDir(id: string): string {
  if (!isRunId(id)) throw new Error(`Invalid run id: ${JSON.stringify(id)}`);
  return join(runsDir(), id, "files");
}

export function runFilePath(id: string, rel: string): string {
  if (!isFilePath(rel)) throw new Error(`Invalid file path: ${JSON.stringify(rel)}`);
  return join(runFilesDir(id), ...rel.split("/"));
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

const queues = new Map<string, Promise<void>>();

/** Persist a snapshot of `run` (serialised now, written in order per run). */
export function saveRun(run: PipelineRun): Promise<void> {
  const json = JSON.stringify(run, null, 2);
  const id = run.id;
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(runsDir(), { recursive: true });
      await writeAtomic(runPath(id), json);
    });
  queues.set(id, next);
  void next.finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  return next;
}

export async function loadRun(id: string): Promise<PipelineRun | null> {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(await readFile(runPath(id), "utf-8")) as PipelineRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listRunIds(): Promise<string[]> {
  try {
    const names = await readdir(runsDir());
    return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter(isRunId);
  } catch {
    return [];
  }
}

export async function writeRunFile(id: string, rel: string, bytes: Uint8Array): Promise<string> {
  const path = runFilePath(id, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, bytes);
  return path;
}

export async function readRunFile(id: string, rel: string): Promise<Uint8Array | null> {
  if (!isRunId(id) || !isFilePath(rel)) return null;
  try {
    return new Uint8Array(await readFile(runFilePath(id, rel)));
  } catch {
    return null;
  }
}
