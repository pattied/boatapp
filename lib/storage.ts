import { del, get, put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

// Photo files live in Vercel Blob; their records live in the database.
// Each upload is one Blob "advanced operation"; nothing here lists the store.

export class StorageNotConfigured extends Error {
  constructor() {
    super("Photo storage is not connected. In Vercel, open this project, go to Storage, and connect a Blob store.");
  }
}

const ACCESS: "public" | "private" = process.env.BLOB_ACCESS === "public" ? "public" : "private";
const LOCAL_DIR = path.join(process.cwd(), ".data", "files");
const YEAR = 31536000;

function mode(): "blob" | "local" {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return "blob";
  if (process.env.VERCEL) throw new StorageNotConfigured();
  return "local";
}

export const srcFor = (pathname: string) => `/p/${pathname}`;

// Paths include the photo's client id, so a retried upload overwrites itself instead of duplicating.
export async function putJpeg(pathname: string, body: Buffer) {
  if (mode() === "blob") {
    await put(pathname, body, {
      access: ACCESS,
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
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
    return { body: new Uint8Array(await fs.readFile(path.join(LOCAL_DIR, pathname))), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

export async function deleteFiles(pathnames: string[]) {
  if (!pathnames.length) return;
  if (mode() === "blob") {
    await del(pathnames);
    return;
  }
  await Promise.all(pathnames.map((p) => fs.rm(path.join(LOCAL_DIR, p), { force: true })));
}
