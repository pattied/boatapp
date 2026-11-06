"use client";

// Browser-only helpers. Storage access is wrapped because private browsing can block it.

const PASSCODE_KEY = "bp_passcode";
const RECENT_KEY = "bp_recent";

export type RecentJob = { id: string; boatName: string; createdAt: string };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the app still works for this visit.
  }
}

export const getPasscode = () => read(PASSCODE_KEY) ?? "";
export const setPasscode = (v: string | null) => write(PASSCODE_KEY, v);

export function getRecent(): RecentJob[] {
  try {
    const list = JSON.parse(read(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecent(job: RecentJob) {
  const list = [job, ...getRecent().filter((j) => j.id !== job.id)].slice(0, 40);
  write(RECENT_KEY, JSON.stringify(list));
}

export function getCover(jobId: string): { before?: string; after?: string } {
  try {
    return JSON.parse(read(`bp_cover_${jobId}`) ?? "{}");
  } catch {
    return {};
  }
}

export function setCover(jobId: string, cover: { before?: string; after?: string }) {
  write(`bp_cover_${jobId}`, JSON.stringify(cover));
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const passcode = getPasscode();
  if (passcode) headers.set("x-passcode", passcode);
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as T;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
