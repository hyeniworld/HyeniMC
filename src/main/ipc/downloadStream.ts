import { BrowserWindow } from 'electron';
import { IPC_EVENTS } from '../../shared/constants';
import { streamDownloadProgress } from '../grpc/clients';
import { timeoutManager, TimeoutType } from '../services/timeout-manager';

let cancelStream: (() => void) | null = null;
let started = false;
let backoffMs = 1000;
const backoffMax = 30000;
let pending: any | null = null;
let throttleTimer: NodeJS.Timeout | null = null;
const HEARTBEAT_KEY = 'grpc-download-stream-heartbeat';

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

      // heartbeat 타임아웃 설정
      timeoutManager.set(HEARTBEAT_KEY, TimeoutType.GRPC_STREAM_HEARTBEAT, () => {
        console.error('[DownloadStream] Heartbeat timeout - stream may be dead');
        broadcast(IPC_EVENTS.DOWNLOAD_ERROR, { 
          error: '다운로드 스트림 연결이 끊어졌습니다. 재연결 중...' 
        });
        if (cancelStream) {
          try { cancelStream(); } catch {}
        }
        scheduleReconnect();
      });

      cancelStream = streamDownloadProgress(
        { profileId: profileId ?? '' },
        (ev) => {
          // 데이터 수신 시 heartbeat 연장
          timeoutManager.extend(HEARTBEAT_KEY, TimeoutType.GRPC_STREAM_HEARTBEAT, () => {
            console.error('[DownloadStream] Heartbeat timeout during stream');
            broadcast(IPC_EVENTS.DOWNLOAD_ERROR, { 
              error: '다운로드 스트림 타임아웃' 
            });
            if (cancelStream) {
              try { cancelStream(); } catch {}
            }
            scheduleReconnect();
          });

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
          timeoutManager.clear(HEARTBEAT_KEY);
          console.warn('[DownloadStream] stream error, will retry:', err?.message || err);
          scheduleReconnect();
        },
        () => {
          timeoutManager.clear(HEARTBEAT_KEY);
          console.log('[DownloadStream] stream ended, will retry');
          scheduleReconnect();
        }
      );
      console.log('[DownloadStream] subscribed with heartbeat monitoring');
      backoffMs = 1000; // reset on success
    } catch (e) {
      timeoutManager.clear(HEARTBEAT_KEY);
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
  timeoutManager.clear(HEARTBEAT_KEY);
  if (cancelStream) {
    try { cancelStream(); } catch {}
    cancelStream = null;
  }
}
