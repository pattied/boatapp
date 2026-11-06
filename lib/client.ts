"use client";

// Browser-only helpers for customers. Storage access is wrapped because private browsing can block it.

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the app still works for this visit.
  }
}

function readList<T>(key: string): T[] {
  try {
    const list = JSON.parse(read(key) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Photo pages a customer has opened on this phone.
export type MyBoat = { id: string; boatName: string; date: string };
const MY_BOATS_KEY = "bp_my_boats";
export const getMyBoats = () => readList<MyBoat>(MY_BOATS_KEY);
export function addMyBoat(boat: MyBoat) {
  write(MY_BOATS_KEY, JSON.stringify([boat, ...getMyBoats().filter((b) => b.id !== boat.id)].slice(0, 30)));
}

// Customer portals opened on this phone (usually one).
export type MyPortal = { token: string; name: string };
const MY_PORTALS_KEY = "cc_portals";
export const getMyPortals = () => readList<MyPortal>(MY_PORTALS_KEY);
export function addMyPortal(p: MyPortal) {
  write(MY_PORTALS_KEY, JSON.stringify([p, ...getMyPortals().filter((x) => x.token !== p.token)].slice(0, 5)));
}
