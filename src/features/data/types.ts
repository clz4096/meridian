/**
 * Data feature — view-facing types shared by the actions layer and the DataView
 * component. Derivation comes from `dataSelectors` and the SyncEngine.
 */
import type { StorageMetrics } from '@/features/data/dataSelectors';

export interface SyncStatus {
  cloudConfigured: boolean;
  pantryId: string;
  baseRev: number;
  dirtyStores: string[];
  lastMessage: string;
  lastMessageBad: boolean;
}

export interface ModelStatus {
  /** whether a key is stored on this device */
  configured: boolean;
  model: string;
  keyPreview: string;
}

export interface DataViewModel {
  metrics: StorageMetrics;
  sync: SyncStatus;
  payloadKb: number;
  model: ModelStatus;
}

export interface DataActions {
  savePantryId(keyId: string, appKey: string): void;
  testConnection(): void;
  push(): void;
  pull(): void;
  exportAll(): void;
  importPasted(text: string): void;
  copyToClipboard(): void;
  importSingle(store: string, text: string): void;
  restoreSnapshot(): void;
  showDiagnostics(): void;
}
