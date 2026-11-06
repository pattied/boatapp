import { randomBytes } from "crypto";

// 128 random bits: job links cannot be guessed.
export const newJobId = () => randomBytes(16).toString("base64url");
export const isJobId = (s: string) => /^[A-Za-z0-9_-]{22}$/.test(s);

// Sortable by time, unique per upload.
export const newFileName = () =>
  `${Date.now().toString().padStart(14, "0")}-${randomBytes(6).toString("base64url")}`;

export const PHOTO_PATH = /^jobs\/[A-Za-z0-9_-]{22}\/(before|after|share)\/[A-Za-z0-9_-]+\.jpg$/;
