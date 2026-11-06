"use client";

import { useState } from "react";

// Copies text (a path becomes a full link when `absolute` is set).
export default function CopyButton({ text, label = "Copy link", absolute }: { text: string; label?: string; absolute?: boolean }) {
  const [done, setDone] = useState(false);
  async function copy() {
    const value = absolute ? `${window.location.origin}${text}` : text;
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      window.prompt("Copy this:", value);
    }
  }
  return (
    <button type="button" className="btn small-btn" onClick={copy}>
      {done ? "Copied" : label}
    </button>
  );
}
