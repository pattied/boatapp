import { del, get, head, list, put } from "@vercel/blob";
import { revalidateTag, unstable_cache } from "next/cache";
import { promises as fs } from "fs";
import path from "path";
import { isJobId, newFileName, newJobId, PHOTO_PATH } from "./ids";

// Layout in storage (never overwritten, so CDN caching is always safe):
//   jobs/<id>/meta.json
//   jobs/<id>/before/<time>-<rand>.jpg
//   jobs/<id>/after/<time>-<rand>.jpg
//   jobs/<id>/share/<time>-<rand>.jpg   (latest one wins)

export type PhotoKind = "before" | "after";

export type Photo = { pathname: string; src: string; uploadedAt: string };

export type JobMeta = {
  id: string;
  boatName: string;
  customerName: string;
  createdAt: string;
};

export type Job = JobMeta & {
  before: Photo[];
  after: Photo[];
  shareImage: string | null;
};

export class StorageNotConfigured extends Error {
  constructor() {
    super(
      "Photo storage is not connected. In Vercel, open this project, go to Storage, and connect a Blob store.",
    );
  }
}

const ACCESS: "public" | "private" = process.env.BLOB_ACCESS === "public" ? "public" : "private";
const LOCAL_DIR = path.join(process.cwd(), ".data");
const YEAR = 31536000;

type Mode = "blob" | "local";

function mode(): Mode {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return "blob";
  // On Vercel the disk is read-only, so local storage only works on a developer machine.
  if (process.env.VERCEL) throw new StorageNotConfigured();
  return "local";
}

export const srcFor = (pathname: string) => `/p/${pathname}`;

async function writeFile(pathname: string, body: Buffer, contentType: string) {
  if (mode() === "blob") {
    await put(pathname, body, {
      access: ACCESS,
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: YEAR,
    });
    return;
  }
  const file = path.join(LOCAL_DIR, pathname);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function readFile(
  pathname: string,
): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; contentType: string } | null> {
  if (mode() === "blob") {
    const res = await get(pathname, { access: ACCESS });
    if (!res || res.statusCode !== 200) return null;
    return { body: res.stream, contentType: res.blob.contentType };
  }
  try {
    const data = await fs.readFile(path.join(LOCAL_DIR, pathname));
    const contentType = pathname.endsWith(".json") ? "application/json" : "image/jpeg";
    return { body: new Uint8Array(data), contentType };
  } catch {
    return null;
  }
}

async function readText(pathname: string): Promise<string | null> {
  const file = await readFile(pathname);
  if (!file) return null;
  return await new Response(file.body as BodyInit).text();
}

async function listUnder(prefix: string): Promise<{ pathname: string; uploadedAt: string }[]> {
  if (mode() === "blob") {
    const out: { pathname: string; uploadedAt: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt).toISOString() });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  const root = path.join(LOCAL_DIR, prefix);
  const out: { pathname: string; uploadedAt: string }[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const stat = await fs.stat(full);
        out.push({
          pathname: path.relative(LOCAL_DIR, full).split(path.sep).join("/"),
          uploadedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  await walk(root);
  return out;
}

export async function createJob(input: { boatName: string; customerName: string }): Promise<JobMeta> {
  const meta: JobMeta = {
    id: newJobId(),
    boatName: input.boatName,
    customerName: input.customerName,
    createdAt: new Date().toISOString(),
  };
  await writeFile(`jobs/${meta.id}/meta.json`, Buffer.from(JSON.stringify(meta)), "application/json");
  revalidateTag(INDEX_TAG, { expire: 0 });
  return meta;
}

// Listing a job's photos is a Blob "advanced operation", and the Hobby plan allows 2,000 a
// month. Job listings are cached in Vercel's shared data cache and expired only when that
// job changes, so page views and link previews don't spend operations.
const jobTag = (id: string) => `job-${id}`;

export async function getJob(id: string): Promise<Job | null> {
  if (!isJobId(id)) return null;
  return unstable_cache(() => loadJob(id), ["job", id], { tags: [jobTag(id)], revalidate: 86400 })();
}

const INDEX_TAG = "jobs-index";

function jobChanged(id: string) {
  revalidateTag(jobTag(id), { expire: 0 });
  revalidateTag(INDEX_TAG, { expire: 0 });
}

export type JobSummary = JobMeta & {
  before: number;
  after: number;
  hasShare: boolean;
  lastActivity: string;
};

// A job's meta.json never changes, so it is cached for good after the first read.
function getMeta(id: string): Promise<JobMeta | null> {
  return unstable_cache(
    async () => {
      const raw = await readText(`jobs/${id}/meta.json`);
      return raw ? (JSON.parse(raw) as JobMeta) : null;
    },
    ["meta", id],
    { revalidate: false },
  )();
}

// Every job from every phone, newest first. One listing per refresh, refreshed only after a change.
export async function listJobs(): Promise<JobSummary[]> {
  return unstable_cache(
    async () => {
      const files = await listUnder("jobs/");
      const byId = new Map<string, { meta: boolean; before: number; after: number; share: number; last: string }>();
      for (const f of files) {
        const m = f.pathname.match(/^jobs\/([A-Za-z0-9_-]{22})\/(meta\.json|before\/|after\/|share\/)/);
        if (!m) continue;
        const entry = byId.get(m[1]) ?? { meta: false, before: 0, after: 0, share: 0, last: f.uploadedAt };
        if (m[2] === "meta.json") entry.meta = true;
        else if (m[2] === "before/") entry.before++;
        else if (m[2] === "after/") entry.after++;
        else entry.share++;
        if (f.uploadedAt > entry.last) entry.last = f.uploadedAt;
        byId.set(m[1], entry);
      }
      const ids = [...byId.entries()].filter(([, e]) => e.meta).map(([id]) => id);
      const metas = await Promise.all(ids.map(getMeta));
      const jobs: JobSummary[] = [];
      metas.forEach((meta, i) => {
        if (!meta) return;
        const e = byId.get(ids[i])!;
        jobs.push({ ...meta, before: e.before, after: e.after, hasShare: e.share > 0, lastActivity: e.last });
      });
      return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    ["jobs-index"],
    { tags: [INDEX_TAG], revalidate: 86400 },
  )();
}

export async function deleteJob(id: string): Promise<void> {
  if (!isJobId(id)) throw new Error("Invalid job");
  if (mode() === "blob") {
    const files = await listUnder(`jobs/${id}/`);
    if (files.length) await del(files.map((f) => f.pathname));
  } else {
    await fs.rm(path.join(LOCAL_DIR, "jobs", id), { recursive: true, force: true });
  }
  jobChanged(id);
}

// Checks a job exists without listing (a "simple operation").
export async function jobExists(id: string): Promise<boolean> {
  if (!isJobId(id)) return false;
  const pathname = `jobs/${id}/meta.json`;
  if (mode() === "blob") {
    try {
      await head(pathname);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await fs.stat(path.join(LOCAL_DIR, pathname));
    return true;
  } catch {
    return false;
  }
}

async function loadJob(id: string): Promise<Job | null> {
  const files = await listUnder(`jobs/${id}/`);
  if (!files.some((f) => f.pathname === `jobs/${id}/meta.json`)) return null;
  const raw = await readText(`jobs/${id}/meta.json`);
  if (!raw) return null;
  const meta = JSON.parse(raw) as JobMeta;

  const photosOf = (folder: string) =>
    files
      .filter((f) => f.pathname.startsWith(`jobs/${id}/${folder}/`) && PHOTO_PATH.test(f.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname))
      .map((f) => ({ pathname: f.pathname, src: srcFor(f.pathname), uploadedAt: f.uploadedAt }));

  const shares = photosOf("share");
  return {
    ...meta,
    before: photosOf("before"),
    after: photosOf("after"),
    shareImage: shares.length ? shares[shares.length - 1].src : null,
  };
}

export async function addPhoto(id: string, folder: PhotoKind | "share", jpeg: Buffer): Promise<Photo> {
  const pathname = `jobs/${id}/${folder}/${newFileName()}.jpg`;
  await writeFile(pathname, jpeg, "image/jpeg");
  jobChanged(id);
  return { pathname, src: srcFor(pathname), uploadedAt: new Date().toISOString() };
}

export async function deletePhoto(id: string, pathname: string): Promise<void> {
  if (!PHOTO_PATH.test(pathname) || !pathname.startsWith(`jobs/${id}/`)) {
    throw new Error("Invalid photo path");
  }
  if (mode() === "blob") await del(pathname);
  else await fs.rm(path.join(LOCAL_DIR, pathname), { force: true });
  jobChanged(id);
}
