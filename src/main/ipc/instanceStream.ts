import { BrowserWindow } from 'electron';
import { streamLogs } from '../grpc/clients';
import { IPC_EVENTS } from '../../shared/constants';

let cancel: (() => void) | null = null;
let started = false;

function broadcast(channel: string, payload: any) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    try { w.webContents.send(channel, payload); } catch {}
  }
}

export function initializeInstanceLogBridge(profileId?: string) {
  if (started) return;
  started = true;
  const req = { profileId: profileId ?? '' } as any;

  const start = () => {
    try {
      cancel = streamLogs(
        req,
        (line) => {
          broadcast(IPC_EVENTS.GAME_LOG, {
            timestamp: Number((line as any).timestamp) || Date.now(),
            level: line.level || 'INFO',
            message: line.message || '',
            source: line.source || 'instance',
          });
        },
        (err) => {
          console.warn('[InstanceStream] stream error, will retry:', err?.message || err);
          scheduleReconnect();
        },
        () => {
          console.log('[InstanceStream] stream ended, will retry');
          scheduleReconnect();
        }
      );
      console.log('[InstanceStream] subscribed');
    } catch (e) {
      console.warn('[InstanceStream] failed to subscribe, will retry:', (e as Error).message);
      scheduleReconnect();
    }
  };

  let timer: NodeJS.Timeout | null = null;
  function scheduleReconnect() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!started) return;
      if (cancel) { try { cancel(); } catch {} }
      start();
    }, 2000);
  }

  setTimeout(start, 300);
}

export function shutdownInstanceLogBridge() {
  started = false;
  if (cancel) { try { cancel(); } catch {} }
  cancel = null;
}
