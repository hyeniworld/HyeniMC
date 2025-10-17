import create from 'zustand';

export type DownloadPhase =
  | 'idle'
  | 'precheck'
  | 'java-check'
  | 'version-resolve'
  | 'assets'
  | 'libraries'
  | 'loader'
  | 'mods'
  | 'patch'
  | 'finalize'
  | 'launch';

interface DownloadState {
  visible: boolean;
  versionId?: string;
  phase: DownloadPhase;
  percent: number; // 0~100
  speed?: string;
  currentFile?: string;
  currentFileDownloaded?: number;
  currentFileTotal?: number;
  totalBytes?: number;
  transferredBytes?: number;
  message?: string;
  error?: string;
  startedAt?: number;
  // Overall task counters (e.g., files/assets)
  totalTasks?: number;
  completedTasks?: number;
  // Mod update fields
  modName?: string;
  modProgress?: number;
  totalMods?: number;
  completedMods?: number;
  show: (versionId?: string) => void;
  hide: () => void;
  setProgress: (partial: Partial<DownloadState>) => void;
  reset: () => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  visible: false,
  phase: 'idle',
  percent: 0,
  show: (versionId?: string) => set({ visible: true, versionId, error: undefined, startedAt: Date.now() }),
  hide: () => set({ visible: false }),
  setProgress: (partial) => set((prev) => {
    const patch: Partial<DownloadState> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined) {
        (patch as any)[k] = v;
      }
    }
    return { ...prev, ...patch } as DownloadState;
  }),
  reset: () => set({
    visible: false,
    versionId: undefined,
    phase: 'idle',
    percent: 0,
    speed: undefined,
    currentFile: undefined,
    currentFileDownloaded: undefined,
    currentFileTotal: undefined,
    totalBytes: undefined,
    transferredBytes: undefined,
    message: undefined,
    error: undefined,
    totalTasks: undefined,
    completedTasks: undefined,
  }),
}));
