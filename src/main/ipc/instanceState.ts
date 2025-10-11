import { BrowserWindow } from 'electron';
import { streamState } from '../grpc/clients';
import { IPC_EVENTS } from '../../shared/constants';

let cancel: (() => void) | null = null;
let started = false;
let backoffMs = 1000;
const backoffMax = 30000;

function broadcast(channel: string, payload: any) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    try { w.webContents.send(channel, payload); } catch {}
  }
}

export function initializeInstanceStateBridge(profileId?: string) {
  if (started) return;
  started = true;
  const req = { profileId: profileId ?? '' } as any;

  const start = async () => {
    try {
      // health check
      const { healthRpc } = await import('../grpc/clients');
      await healthRpc.check();
      cancel = streamState(
        req,
        (ev) => {
          const state = (ev.state || '').toLowerCase();
          if (state === 'started') {
            broadcast(IPC_EVENTS.GAME_STARTED, {
              versionId: ev.profileId || '',
              pid: (ev as any).pid || 0,
            });
          } else if (state === 'stopped') {
            broadcast(IPC_EVENTS.GAME_STOPPED, {
              versionId: ev.profileId || '',
              code: (ev as any).exitCode ?? 0,
            });
          } else if (state === 'crashed') {
            broadcast(IPC_EVENTS.GAME_CRASHED, {
              versionId: ev.profileId || '',
              code: (ev as any).exitCode ?? -1,
            });
          }
        },
        (err) => {
          console.warn('[InstanceState] stream error, will retry:', err?.message || err);
          scheduleReconnect();
        },
        () => {
          console.log('[InstanceState] stream ended, will retry');
          scheduleReconnect();
        }
      );
      console.log('[InstanceState] subscribed');
      backoffMs = 1000;
    } catch (e) {
      console.warn('[InstanceState] failed to subscribe, will retry:', (e as Error).message);
      scheduleReconnect();
    }
  };

  let retryTimer: NodeJS.Timeout | null = null;
  function scheduleReconnect() {
    if (retryTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMax, Math.floor(backoffMs * 2));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!started) return;
      if (cancel) { try { cancel(); } catch {} }
      start();
    }, delay);
  }

  setTimeout(() => { start().catch(() => scheduleReconnect()); }, 300);
}

export function shutdownInstanceStateBridge() {
  started = false;
  if (cancel) { try { cancel(); } catch {} }
  cancel = null;
}
