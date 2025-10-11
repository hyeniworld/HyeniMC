import { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/constants';
import { streamDownloadProgress } from '../grpc/clients';

let cancelStream: (() => void) | null = null;
let started = false;
let backoffMs = 1000;
const backoffMax = 30000;
let pending: any | null = null;
let throttleTimer: NodeJS.Timeout | null = null;

function broadcast(channel: string, payload: any) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try { win.webContents.send(channel, payload); } catch {}
  }
}

export function initializeDownloadStreamBridge(profileId?: string) {
  if (started) return;
  started = true;

  const start = async () => {
    try {
      // Health check before subscribing
      const { healthRpc } = await import('../grpc/clients');
      await healthRpc.check();

      cancelStream = streamDownloadProgress(
        { profileId: profileId ?? '' },
        (ev) => {
          const base = {
            taskId: ev.taskId,
            type: ev.type,
            name: ev.name,
            progress: ev.progress,
            downloaded: Number((ev as any).downloaded),
            total: Number((ev as any).total),
            status: ev.status,
            error: ev.error,
          };

          // throttle to 100ms
          pending = base;
          if (!throttleTimer) {
            throttleTimer = setTimeout(() => {
              const data = pending;
              pending = null;
              throttleTimer = null;
              if (!data) return;
              if (data.status === 'completed') {
                broadcast(IPC_EVENTS.DOWNLOAD_COMPLETE, data);
              } else if (data.status === 'failed') {
                broadcast(IPC_EVENTS.DOWNLOAD_ERROR, data);
              } else {
                broadcast(IPC_EVENTS.DOWNLOAD_PROGRESS, data);
              }
            }, 100);
          }
        },
        (err) => {
          console.warn('[DownloadStream] stream error, will retry:', err?.message || err);
          scheduleReconnect();
        },
        () => {
          console.log('[DownloadStream] stream ended, will retry');
          scheduleReconnect();
        }
      );
      console.log('[DownloadStream] subscribed');
      backoffMs = 1000; // reset on success
    } catch (e) {
      console.warn('[DownloadStream] failed to subscribe, will retry:', (e as Error).message);
      scheduleReconnect();
    }
  };

  let retryTimer: NodeJS.Timeout | null = null;
  function scheduleReconnect() {
    if (retryTimer) return;
    // Exponential backoff with cap
    const delay = backoffMs;
    backoffMs = Math.min(backoffMax, Math.floor(backoffMs * 2));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!started) return;
      if (cancelStream) { try { cancelStream(); } catch {} }
      start();
    }, delay);
  }

  // defer a little to allow windows to be ready
  setTimeout(() => { start().catch(() => scheduleReconnect()); }, 300);
}

export function shutdownDownloadStreamBridge() {
  started = false;
  if (cancelStream) {
    try { cancelStream(); } catch {}
    cancelStream = null;
  }
}
