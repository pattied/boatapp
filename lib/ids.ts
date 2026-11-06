import { randomBytes } from "crypto";

// 128 random bits: customer photo links and portal links cannot be guessed.
export const newPublicId = () => randomBytes(16).toString("base64url");
export const isPublicId = (s: string) => /^[A-Za-z0-9_-]{22}$/.test(s);
export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Stored photos: jobs/<job public id>/<kind>/<name>.jpg
export const PHOTO_PATH = /^jobs\/[A-Za-z0-9_-]{22}\/(before|after|share|issue|skip)\/[A-Za-z0-9_-]+\.jpg$/;
