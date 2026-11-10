"use client";

// On-device outbox for technician work. Every action and photo is saved here first, so nothing
// waits on the network; a sync loop sends items in order whenever the app is open with signal.
// Items are deleted only after the server confirms them.

export type OutboxEvent = {
  id: string; // client id, also the server's idempotency key
  kind: "event";
  jobId: string;
  createdAt: number;
  type: "start" | "complete" | "skip" | "flag";
  at: string;
  data?: Record<string, unknown>;
};

export type OutboxPhoto = {
  id: string;
  kind: "photo";
  jobId: string;
  createdAt: number;
  photoKind: "before" | "after" | "issue" | "skip" | "share";
  slot: string;
  takenAt: string;
  blob: Blob;
};

export type OutboxItem = OutboxEvent | OutboxPhoto;

const DB = "cc-outbox";
const STORE = "items";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const outboxAdd = (item: OutboxItem) => run("readwrite", (s) => s.put(item)).then(() => undefined);
export const outboxRemove = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);
export async function outboxAll(): Promise<OutboxItem[]> {
  const items = (await run("readonly", (s) => s.getAll())) as OutboxItem[];
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
      );

export type SendResult = "sent" | "offline" | "signed_out" | "dropped";

// Sends one item. "dropped" means the server rejected it for good (for example the job was deleted).
export async function sendItem(item: OutboxItem): Promise<SendResult> {
  let res: Response;
  try {
    if (item.kind === "event") {
      res = await fetch("/api/crew/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: item.id, jobId: item.jobId, type: item.type, at: item.at, data: item.data }),
      });
    } else {
      res = await fetch("/api/crew/photos", {
        method: "POST",
        headers: {
          "content-type": "image/jpeg",
          "x-client-id": item.id,
          "x-job-id": item.jobId,
          "x-kind": item.photoKind,
          "x-slot": encodeURIComponent(item.slot),
          "x-taken-at": item.takenAt,
        },
        body: item.blob,
      });
    }
  } catch {
    return "offline";
  }
  if (res.ok) return "sent";
  if (res.status === 401) return "signed_out";
  if (res.status === 404 || res.status === 400 || res.status === 403) return "dropped";
  return "offline"; // server error: keep it and retry later
}
