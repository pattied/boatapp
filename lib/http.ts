import { StorageNotConfigured } from "./storage";

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

export function failure(err: unknown) {
  if (err instanceof StorageNotConfigured) return json({ error: err.message }, 503);
  console.error(err);
  return json({ error: "Something went wrong on the server. Try again." }, 500);
}

const MAX_JPEG = 4_000_000; // Vercel functions accept request bodies up to 4.5 MB.

export async function readJpeg(req: Request): Promise<Buffer | string> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("image/jpeg")) return "Photos must be sent as JPEG.";
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return "The photo was empty.";
  if (buf.length > MAX_JPEG) return "The photo is too large.";
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return "That file is not a JPEG photo.";
  return buf;
}

// Reads a trimmed string field from a form, capped in length.
export function field(fd: FormData, name: string, max = 200): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function flag(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}
