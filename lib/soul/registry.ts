/**
 * The Identity registry (slice C; docs/spec/identity.md §6–§8, docs/spec/api.md §2.0).
 *
 * Layout under `${DATA_DIR:-.data}/identities/<id>/`:
 *   identity.json      the portable document; every ref has a local `path`
 *   refs/ref_N.png     the 3–6 crops (re-encoded, no metadata; originals are never stored)
 *   assets.json        Comfy asset cache: { origin, bySha: { <sha256>: <assetId> } }
 *
 * Callers see refs with an `assetId` when the cache holds one for the current
 * backend origin, else with their `path`. `ensureAssets` uploads whatever is
 * missing or stale, by sha256, never resubmitting a job (§7.1 "Cache miss").
 * Imported read-only by Photoshoot (D) and Motion (F). Server-only.
 */
import "server-only";

import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { apiOrigin, createClient } from "../comfy.ts";
import { assertIdentityConsent } from "../identity/consent.ts";
import { checkPhoto, sniffImage, stripMetadata, type Candidate, type QaOptions } from "../identity/qa.ts";
import { dataDir } from "../store.ts";
import type { CropBox, Identity, IdentityRef, StyleCard } from "../types.ts";
import { IDENTITY_MAX_REFS, IDENTITY_MIN_REFS, IDENTITY_SCHEMA } from "../types.ts";

/** A ref whose image is a Comfy asset (usable as a graph image input). */
export type AssetSoulRef = Extract<IdentityRef, { assetId: string }>;

/** Thrown by `bestRefs` / `getSoulOrThrow` callers for an unknown id (routes map it to 404). */
export class SoulNotFoundError extends Error {
  readonly identityId: string;
  constructor(identityId: string) {
    super(`Identity ${identityId} not found.`);
    this.name = "SoulNotFoundError";
    this.identityId = identityId;
  }
}

/** A bundle or request the registry refuses (routes map it to 400). */
export class IdentityInputError extends Error {
  readonly field: string;
  /** Read by the pipeline runner's planError (400 with `field`). */
  readonly status = 400;
  constructor(field: string, message: string) {
    super(message);
    this.name = "IdentityInputError";
    this.field = field;
  }
}

/** The slice of the Comfy client the registry uses (tests inject a fake). */
export type AssetClient = {
  assets: {
    fromBytes(data: Uint8Array, options?: { filename?: string; contentType?: string }): { commit(signal?: AbortSignal): Promise<string> };
    get(assetId: string): Promise<unknown>;
    delete(assetId: string, signal?: AbortSignal): Promise<void>;
  };
};

let clientOverride: AssetClient | null = null;
let defaultClient: AssetClient | null = null;
/** Tests: route registry uploads to a fake client (null restores the real one). */
export function setRegistryClient(client: AssetClient | null): void {
  clientOverride = client;
}
function client(): AssetClient {
  return clientOverride ?? (defaultClient ??= createClient() as unknown as AssetClient);
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isIdentityId = (id: string) => ID.test(id);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const refPath = (n: number) => `refs/ref_${n}.png`;

export function identitiesDir(): string {
  return join(dataDir(), "identities");
}
function dir(id: string): string {
  if (!isIdentityId(id)) throw new SoulNotFoundError(id);
  return join(identitiesDir(), id);
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

type AssetCache = { origin: string; bySha: Record<string, string> };

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function readCache(id: string): Promise<AssetCache> {
  const cache = await readJson<AssetCache>(join(dir(id), "assets.json"));
  // A cache for another backend is useless here (§7.1): start empty.
  return cache && cache.origin === apiOrigin() && cache.bySha ? cache : { origin: apiOrigin(), bySha: {} };
}

/** The stored document (refs with local paths), or null. */
async function readStored(id: string): Promise<Identity | null> {
  if (!isIdentityId(id)) return null;
  const doc = await readJson<Identity>(join(dir(id), "identity.json"));
  return doc && doc.schema === IDENTITY_SCHEMA && doc.id === id ? doc : null;
}

function withCachedAssets(doc: Identity, cache: AssetCache): Identity {
  return {
    ...doc,
    refs: doc.refs.map((ref) => {
      const { assetId: _a, path: _p, ...rest } = ref;
      void _a;
      void _p;
      const assetId = cache.bySha[ref.sha256];
      return (assetId ? { ...rest, assetId } : { ...rest, path: ref.path ?? "" }) as IdentityRef;
    }),
  };
}

/**
 * `consent` is the uploader's likeness-consent value (form field or JSON),
 * checked here with assertIdentityConsent so no identity is saved without
 * it; the time it was given is stored as `consentedAt`.
 */
export type NewIdentity = { name: string; consent: unknown; refs: Candidate[]; styleCard?: Partial<StyleCard> };

export function normalizeStyleCard(card: Partial<StyleCard> | undefined): StyleCard {
  const description = typeof card?.description === "string" ? card.description.trim().slice(0, 400) : "";
  const traits: StyleCard["traits"] = {};
  for (const [k, v] of Object.entries(card?.traits ?? {})) {
    if (typeof v === "string" && v.trim()) traits[k as keyof StyleCard["traits"]] = v.trim().slice(0, 80);
  }
  const keep = Array.isArray(card?.keep) ? card.keep.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim().slice(0, 120)).slice(0, 8) : [];
  return { description, traits, keep };
}

/** Save a freshly curated identity: crops best-first, refs by local path. */
export async function createIdentity(input: NewIdentity): Promise<Identity> {
  assertIdentityConsent(input.consent);
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new IdentityInputError("name", "Give the identity a name.");
  if (input.refs.length < IDENTITY_MIN_REFS || input.refs.length > IDENTITY_MAX_REFS) {
    throw new IdentityInputError("photos", `An identity needs ${IDENTITY_MIN_REFS}–${IDENTITY_MAX_REFS} reference crops.`);
  }
  const id = crypto.randomUUID();
  const root = dir(id);
  await mkdir(join(root, "refs"), { recursive: true });
  const refs: IdentityRef[] = [];
  for (const [n, c] of input.refs.entries()) {
    await writeAtomic(join(root, refPath(n)), c.png);
    refs.push({ path: refPath(n), crop: c.crop, phash: c.phash, sha256: c.sha256, qaScore: Math.round(c.score * 1000) / 1000 });
  }
  const doc: Identity = {
    schema: IDENTITY_SCHEMA,
    id,
    name,
    createdAt: new Date().toISOString(),
    consentedAt: new Date().toISOString(),
    refs,
    styleCard: normalizeStyleCard(input.styleCard),
  };
  await writeAtomic(join(root, "identity.json"), JSON.stringify(doc, null, 2));
  return doc;
}

/** Every saved Identity, newest first. */
export async function listSouls(): Promise<Identity[]> {
  let names: string[];
  try {
    names = await readdir(identitiesDir());
  } catch {
    return [];
  }
  const out: Identity[] = [];
  for (const name of names.filter(isIdentityId)) {
    const doc = await readStored(name);
    if (doc) out.push(withCachedAssets(doc, await readCache(name)));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One Identity by id, or `null` if absent. */
export async function getSoul(id: string): Promise<Identity | null> {
  const doc = await readStored(id);
  return doc ? withCachedAssets(doc, await readCache(id)) : null;
}

/** The PNG of ref `n`, or null. */
export async function readRefPng(id: string, n: number): Promise<Uint8Array | null> {
  const doc = await readStored(id);
  if (!doc || !Number.isInteger(n) || n < 0 || n >= doc.refs.length) return null;
  try {
    return new Uint8Array(await readFile(join(dir(id), refPath(n))));
  } catch {
    return null;
  }
}

/** True when Comfy still has the asset (a 404, or any lookup failure, means re-upload). */
async function assetAlive(assetId: string): Promise<boolean> {
  try {
    await client().assets.get(assetId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make every ref a Comfy asset: upload refs that only have a `path` (an
 * imported bundle) or whose asset is gone, persist the new ids, and return the
 * updated Identity. Idempotent (content-addressed by `sha256`).
 */
export async function ensureAssets(soul: Identity, signal?: AbortSignal): Promise<Identity & { refs: AssetSoulRef[] }> {
  const doc = await readStored(soul.id);
  if (!doc) throw new SoulNotFoundError(soul.id);
  const cache = await readCache(soul.id);
  let changed = false;
  for (const [n, ref] of doc.refs.entries()) {
    const cached = cache.bySha[ref.sha256];
    if (cached && (await assetAlive(cached))) continue;
    const bytes = new Uint8Array(await readFile(join(dir(soul.id), refPath(n))));
    if (sha256(bytes) !== ref.sha256) throw new Error(`Identity ${soul.id}: ref ${n} no longer matches its sha256.`);
    cache.bySha[ref.sha256] = await client().assets.fromBytes(bytes, { filename: `ref_${n}.png`, contentType: "image/png" }).commit(signal);
    changed = true;
  }
  if (changed) await writeAtomic(join(dir(soul.id), "assets.json"), JSON.stringify(cache, null, 2));
  return withCachedAssets(doc, cache) as unknown as Identity & { refs: AssetSoulRef[] };
}

/**
 * The identity's best `n` refs (best first, `1 <= n <= IDENTITY_MAX_REFS`, fewer if the
 * Identity has fewer), each with a live `assetId` (`ensureAssets` applied).
 * Throws SoulNotFoundError for an unknown id, and IdentityInputError for an
 * identity with no likeness-consent record (no job uses it).
 */
export async function bestRefs(identityId: string, n: number): Promise<AssetSoulRef[]> {
  const soul = await getSoul(identityId);
  if (!soul) throw new SoulNotFoundError(identityId);
  if (!soul.consentedAt) throw new IdentityInputError("identityId", "That identity has no likeness-consent record. Create or import it again.");
  const count = Math.max(1, Math.min(IDENTITY_MAX_REFS, Math.floor(n)));
  const ready = await ensureAssets(soul);
  return (ready.refs as AssetSoulRef[]).slice(0, count);
}

/** The identity whose cached assets include every one of `assetIds` (preview runs), or null. */
export async function findByAssetIds(assetIds: string[]): Promise<Identity | null> {
  for (const soul of await listSouls()) {
    const ids = new Set(soul.refs.map((r) => r.assetId).filter(Boolean));
    if (assetIds.length && assetIds.every((a) => ids.has(a))) return soul;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bundles (§6.1, §6.5)
// ---------------------------------------------------------------------------

/** `.identity.zip`: identity.json (refs by path, no assetIds or URLs) + refs/ref_N.png. */
export async function exportBundle(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const doc = await readStored(id);
  if (!doc) throw new SoulNotFoundError(id);
  const files: Record<string, Uint8Array> = {};
  const refs = doc.refs.map((ref, n) => ({ ...ref, assetId: undefined, path: refPath(n) }));
  for (const n of doc.refs.keys()) files[refPath(n)] = new Uint8Array(await readFile(join(dir(id), refPath(n))));
  // Consent is per studio: whoever imports the bundle gives their own (importBundle).
  const { consentedAt: _consented, ...portable } = doc;
  void _consented;
  files["identity.json"] = strToU8(JSON.stringify({ ...portable, refs }, null, 2));
  const slug = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "identity";
  return { filename: `${slug}.identity.zip`, bytes: zipSync(files, { level: 6 }) };
}

/** Largest bundle accepted: 6 refs of at most ~8 MB plus JSON. */
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
/** Inflated-size caps (zip-bomb guard), checked before anything is inflated. */
const MAX_REF_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_INFLATED_BYTES = 60 * 1024 * 1024;
/** identity.json plus at most IDENTITY_MAX_REFS refs. */
const MAX_BUNDLE_FILES = IDENTITY_MAX_REFS + 1;
/** Every central-directory entry, folders included. */
const MAX_BUNDLE_ENTRIES = 2 * MAX_BUNDLE_FILES;
/** What exportBundle writes, optionally one folder deep (`<name>.identity/…`). */
const BUNDLE_FILE = /^(?:[^/]+\/)?(?:identity\.json|refs\/ref_[0-5]\.png)$/;
const REF_PATH = /^refs\/ref_[0-5]\.png$/;

class BundleRefused extends Error {}

/**
 * Inflate only what a bundle may hold: `identity.json` and `refs/ref_N.png`
 * (one optional leading folder), at most MAX_BUNDLE_FILES files and
 * MAX_INFLATED_BYTES in all. The filter runs on each central-directory entry
 * before it is inflated, and fflate inflates into a buffer of exactly the
 * declared size, so the declared sizes bound memory.
 */
function unzipBundle(zip: Uint8Array): Record<string, Uint8Array> {
  let entries = 0;
  let files = 0;
  let total = 0;
  try {
    return unzipSync(zip, {
      filter: (f: { name: string; size: number; originalSize: number }) => {
        if (++entries > MAX_BUNDLE_ENTRIES) throw new BundleRefused("That bundle has too many files.");
        // Folder entries hold nothing and are skipped.
        if (f.name.endsWith("/") && f.originalSize === 0 && f.size === 0) return false;
        if (!BUNDLE_FILE.test(f.name)) throw new BundleRefused("That bundle holds files an .identity.zip never has.");
        const cap = f.name.endsWith(".json") ? MAX_JSON_BYTES : MAX_REF_BYTES;
        const bytes = Math.max(f.size, f.originalSize);
        total += bytes;
        if (++files > MAX_BUNDLE_FILES) throw new BundleRefused("That bundle has too many files.");
        if (bytes > cap || total > MAX_INFLATED_BYTES) throw new BundleRefused("That bundle is too large.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof BundleRefused) throw new IdentityInputError("bundle", error.message);
    throw new IdentityInputError("bundle", "That isn't a readable .identity.zip.");
  }
}

/** A crop box from an untrusted bundle: finite, non-negative, non-empty, in pixel range. */
function bundleCrop(raw: unknown, field: string): CropBox {
  const c = raw as Record<string, unknown> | null;
  const MAX = 100_000;
  const num = (v: unknown, min: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= MAX ? Math.round(v) : null);
  const x = num(c?.x, 0);
  const y = num(c?.y, 0);
  const width = num(c?.width, 1);
  const height = num(c?.height, 1);
  if (x === null || y === null || width === null || height === null || x + width > MAX || y + height > MAX) {
    throw new IdentityInputError(field, "Each ref needs a crop box of whole, non-negative pixel numbers.");
  }
  return { x, y, width, height };
}

/**
 * Import an untrusted bundle (§6.5) after the importer's likeness consent:
 * schema, 3–6 refs, `refs/ref_N.png` paths, every sha256, crop boxes, and
 * Q1/Q2/Q7 again on each ref (the face detector runs on every ref, whatever
 * its size). Saved under a fresh id with no assetIds; `ensureAssets` uploads
 * the refs when a job first needs them.
 */
export async function importBundle(zip: Uint8Array, consent: unknown, options: QaOptions = {}): Promise<Identity> {
  assertIdentityConsent(consent);
  if (zip.byteLength > MAX_BUNDLE_BYTES) throw new IdentityInputError("bundle", "That bundle is too large.");
  const files = unzipBundle(zip);
  const jsonKey = Object.keys(files).find((k) => k.endsWith("identity.json"));
  if (!jsonKey) throw new IdentityInputError("bundle", "The bundle has no identity.json.");
  const base = jsonKey.slice(0, -"identity.json".length);
  let doc: Identity;
  try {
    doc = JSON.parse(strFromU8(files[jsonKey])) as Identity;
  } catch {
    throw new IdentityInputError("bundle", "identity.json isn't valid JSON.");
  }
  if (typeof doc?.schema !== "string" || !doc.schema.startsWith("open-frame-studio/identity@")) {
    throw new IdentityInputError("bundle", "Unknown identity format.");
  }
  if (doc.schema !== IDENTITY_SCHEMA) throw new IdentityInputError("bundle", `Unsupported identity version ${doc.schema}.`);
  if (!Array.isArray(doc.refs) || doc.refs.length < IDENTITY_MIN_REFS || doc.refs.length > IDENTITY_MAX_REFS) {
    throw new IdentityInputError("bundle", `An identity needs ${IDENTITY_MIN_REFS}–${IDENTITY_MAX_REFS} refs.`);
  }
  const candidates: Candidate[] = [];
  for (const [n, ref] of doc.refs.entries()) {
    if (typeof ref?.path !== "string" || !REF_PATH.test(ref.path)) {
      throw new IdentityInputError(`refs[${n}].path`, "Ref paths must be relative refs/ref_N.png paths.");
    }
    const bytes = files[base + ref.path];
    if (!bytes) throw new IdentityInputError(`refs[${n}].path`, `Missing ${ref.path}.`);
    if (typeof ref.sha256 !== "string" || sha256(bytes) !== ref.sha256.toLowerCase()) {
      throw new IdentityInputError(`refs[${n}].sha256`, `${ref.path} doesn't match its sha256.`);
    }
    if (sniffImage(bytes) !== "image/png") throw new IdentityInputError(`refs[${n}].path`, `${ref.path} isn't a PNG.`);
    const crop = bundleCrop(ref.crop, `refs[${n}].crop`);
    // Q1, Q2 and Q7 again: a bundle is untrusted input. Stored crops may be
    // under the 512 px intake minimum, so size is not a reason here, but the
    // face detector always runs.
    const qa = await checkPhoto(bytes, n, { ...options, importedRef: true });
    if (qa.reason) throw new IdentityInputError(`refs[${n}]`, `${ref.path}: ${qa.reason.replace(/_/g, " ")}.`);
    const checked = qa as Candidate;
    // Store a metadata-free re-encode, not the zip bytes (§8.2). The sha256
    // check above already proved the bundle matches what it claims.
    const png = await stripMetadata(bytes);
    candidates.push({
      ...checked,
      png,
      sha256: sha256(png),
      phash: typeof ref.phash === "string" && /^[0-9a-f]{16}$/.test(ref.phash) ? ref.phash : checked.phash,
      crop,
      score: typeof ref.qaScore === "number" && ref.qaScore >= 0 && ref.qaScore <= 1 ? ref.qaScore : checked.score,
      pixelSha: "",
    });
  }
  return createIdentity({ name: typeof doc.name === "string" ? doc.name : "imported", consent, refs: candidates, styleCard: doc.styleCard });
}

/**
 * Delete on request (§8.4): the local folder, and each cached Comfy asset
 * (best effort; an asset still referenced by a job may refuse with 409).
 */
export async function deleteIdentity(id: string): Promise<{ deleted: boolean; assetsNotDeleted: number }> {
  const doc = await readStored(id);
  if (!doc) return { deleted: false, assetsNotDeleted: 0 };
  const cache = await readCache(id);
  let failed = 0;
  for (const assetId of Object.values(cache.bySha)) {
    try {
      await client().assets.delete(assetId);
    } catch {
      failed++;
    }
  }
  await rm(dir(id), { recursive: true, force: true });
  return { deleted: true, assetsNotDeleted: failed };
}
