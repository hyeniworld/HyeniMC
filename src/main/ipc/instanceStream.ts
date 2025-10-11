import { BrowserWindow } from 'electron';
import { streamLogs } from '../grpc/clients';
import { IPC_EVENTS } from '../../shared/constants';

let cancel: (() => void) | null = null;
let started = false;
let backoffMs = 1000;
const backoffMax = 30000;
let pending: any | null = null;
let throttleTimer: NodeJS.Timeout | null = null;

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

  const start = async () => {
    try {
      // health check
      const { healthRpc } = await import('../grpc/clients');
      await healthRpc.check();
      cancel = streamLogs(
        req,
        (line) => {
          const base = {
            timestamp: Number((line as any).timestamp) || Date.now(),
            level: line.level || 'INFO',
            message: line.message || '',
            source: line.source || 'instance',
          };
          pending = base;
          if (!throttleTimer) {
            throttleTimer = setTimeout(() => {
              throttleTimer = null;
              const data = pending; pending = null;
              if (!data) return;
              broadcast(IPC_EVENTS.GAME_LOG, data);
            }, 100);
          }
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
      backoffMs = 1000;
    } catch (e) {
      console.warn('[InstanceStream] failed to subscribe, will retry:', (e as Error).message);
      scheduleReconnect();
    }
  };

  let timer: NodeJS.Timeout | null = null;
  function scheduleReconnect() {
    if (timer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMax, Math.floor(backoffMs * 2));
    timer = setTimeout(() => {
      timer = null;
      if (!started) return;
      if (cancel) { try { cancel(); } catch {} }
      start();
    }, delay);
  }

  setTimeout(() => { start().catch(() => scheduleReconnect()); }, 300);
}

export function shutdownInstanceLogBridge() {
  started = false;
  if (cancel) { try { cancel(); } catch {} }
  cancel = null;
}
