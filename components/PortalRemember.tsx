"use client";

import { useEffect } from "react";
import { addMyPortal } from "@/lib/client";

// Remembers the portal on this phone, so "Customer" on the start screen opens it next time.
export default function PortalRemember({ token, name }: { token: string; name: string }) {
  useEffect(() => addMyPortal({ token, name }), [token, name]);
  return null;
}
