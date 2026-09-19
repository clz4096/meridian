/**
 * Proof / Derivation Journal — ORDINARY-tier local state. A dated log of
 * proofs, derivations, and "reconstruct from memory" attempts, the way a
 * theory student keeps a notebook. Persisted to the namespaced key
 * `meridian.proofjournal.v1`; not routed through the sync kernel.
 */
import { signal } from '@preact/signals';

export interface JournalEntry {
  id: string;
  at: number; // epoch ms
  title: string;
  body: string;
  /** Written cold from memory (a retrieval attempt) rather than copied. Old
   *  entries predate the flag → undefined, treated as false. */
  reconstructed?: boolean;
}

const KEY = 'meridian.proofjournal.v1';

function load(): JournalEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown;
    if (Array.isArray(v)) return v as JournalEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

export const journalEntries = signal<JournalEntry[]>(load());

function persist(next: JournalEntry[]): void {
  journalEntries.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

function rid(): string {
  // No crypto dependency needed; timestamp + random suffix is unique enough here.
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Add a new entry; newest first. Returns false if both fields are blank. */
export function addEntry(title: string, body: string, reconstructed = false): boolean {
  const t = title.trim();
  const b = body.trim();
  if (!t && !b) return false;
  persist([
    { id: rid(), at: Date.now(), title: t || 'Untitled', body: b, ...(reconstructed ? { reconstructed: true } : {}) },
    ...journalEntries.value,
  ]);
  return true;
}

export function deleteEntry(id: string): void {
  persist(journalEntries.value.filter((e) => e.id !== id));
}

/** Flip the "reconstructed from memory" flag on an entry. */
export function toggleReconstructed(id: string): void {
  persist(journalEntries.value.map((e) => (e.id === id ? { ...e, reconstructed: !e.reconstructed } : e)));
}
