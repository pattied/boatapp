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

// A person's name, entered as two fields. `name` is the full name used for display everywhere.
export type PersonName = { first: string; last: string; name: string };
export function personName(fd: FormData): PersonName {
  const first = field(fd, "first_name", 50).replace(/\s+/g, " ");
  const last = field(fd, "last_name", 50).replace(/\s+/g, " ");
  return { first, last, name: `${first} ${last}`.trim() };
}

// Stores the two parts next to the full name on a customers, contacts or technicians row.
export async function saveNameParts(
  run: (text: string, params?: unknown[]) => Promise<unknown>,
  table: "customers" | "contacts" | "technicians",
  id: string,
  n: PersonName,
) {
  await run(`update ${table} set first_name = $2, last_name = $3 where id = $1`, [id, n.first, n.last]);
}
