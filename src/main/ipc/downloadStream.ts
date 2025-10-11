import { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/constants';
import { streamDownloadProgress } from '../grpc/clients';

let cancelStream: (() => void) | null = null;
let started = false;

function broadcast(channel: string, payload: any) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try { win.webContents.send(channel, payload); } catch {}
  }
}

export function initializeDownloadStreamBridge(profileId?: string) {
  if (started) return;
  started = true;

  const start = () => {
    try {
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

          if (ev.status === 'completed') {
            broadcast(IPC_EVENTS.DOWNLOAD_COMPLETE, base);
          } else if (ev.status === 'failed') {
            broadcast(IPC_EVENTS.DOWNLOAD_ERROR, base);
          } else {
            broadcast(IPC_EVENTS.DOWNLOAD_PROGRESS, base);
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
    } catch (e) {
      console.warn('[DownloadStream] failed to subscribe, will retry:', (e as Error).message);
      scheduleReconnect();
    }
  };

  let retryTimer: NodeJS.Timeout | null = null;
  function scheduleReconnect() {
    if (retryTimer) return;
    // Exponential backoff (simple): 1.5s fixed for now; can enhance later
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!started) return;
      if (cancelStream) { try { cancelStream(); } catch {} }
      start();
    }, 1500);
  }

  // defer a little to allow windows to be ready
  setTimeout(start, 300);
}

export function shutdownDownloadStreamBridge() {
  started = false;
  if (cancelStream) {
    try { cancelStream(); } catch {}
    cancelStream = null;
  }
}
