import { useEffect } from 'react';
import { useDownloadStore } from '../store/downloadStore';

// Existing IPC_EVENTS
const EVT_DL_PROGRESS = 'download:progress';
const EVT_DL_FILE_PROGRESS = 'download:file-progress';
const EVT_DL_COMPLETE = 'download:complete';
const EVT_DL_ERROR = 'download:error';
const EVT_GAME_DOWNLOAD_PROGRESS = 'game:download-progress';
const EVT_GAME_STARTED = 'game:started';

export function useDownloadProgress() {
  const setProgress = useDownloadStore((s) => s.setProgress);
  const show = useDownloadStore((s) => s.show);
  const hide = useDownloadStore((s) => s.hide);
  const visible = useDownloadStore((s) => s.visible);

  useEffect(() => {
    // Any progress should surface the modal if not visible
    const onAnyProgress = (data: any) => {
      if (!visible && (data?.percent != null || data?.transferredBytes > 0 || data?.overallProgress != null)) {
        // Prefer human-friendly title: profileName/profile.name/versionName > versionId
        const title = data?.profileName || data?.profile?.name || data?.versionName || data?.versionId;
        show(title);
      }
      // Even if already visible, update header if a better title arrives (exclude generic name field)
      const headerTitle = data?.profileName || data?.profile?.name || data?.versionName || undefined;
      const { percent, speed, currentFile, totalBytes, transferredBytes, message, phase } = data || {};
      // Support various counter field names from backend
      const totalTasks = data?.totalTasks ?? data?.totalAssets ?? data?.totalFiles;
      const completedTasks = data?.completedTasks ?? data?.completedAssets ?? data?.completedFiles;
      // Current file counters (common names: downloaded/total)
      const currentFileDownloaded = data?.downloaded ?? data?.currentDownloaded ?? undefined;
      const currentFileTotal = data?.total ?? data?.currentTotal ?? undefined;
      const percentFallback = (() => {
        if (typeof percent === 'number') return percent;
        if (totalBytes && transferredBytes) return (transferredBytes / totalBytes) * 100;
        if (totalTasks && completedTasks) return (completedTasks / totalTasks) * 100;
        if (typeof data?.overallProgress === 'number') return data.overallProgress;
        return 0;
      })();
      setProgress({
        percent: percentFallback,
        speed,
        currentFile,
        totalBytes,
        transferredBytes,
        message,
        phase: phase || 'version-resolve',
        totalTasks,
        completedTasks,
        currentFileDownloaded,
        currentFileTotal,
        ...(headerTitle ? { versionId: headerTitle } : {}),
      });
    };

    const offDlProgress = window.electronAPI.on(EVT_DL_PROGRESS, onAnyProgress);
    const offDlFileProgress = window.electronAPI.on(EVT_DL_FILE_PROGRESS, onAnyProgress);
    const offGameDl = window.electronAPI.on(EVT_GAME_DOWNLOAD_PROGRESS, onAnyProgress);

    const offError = window.electronAPI.on(EVT_DL_ERROR, (err: any) => {
      const errorMessage = typeof err === 'string' ? err : err?.message || '다운로드 오류';
      setProgress({ error: errorMessage });
      
      // 3초 후 자동으로 에러 상태 초기화 및 모달 닫기
      setTimeout(() => {
        setProgress({ error: undefined });
        hide();
      }, 3000);
    });

    const offComplete = window.electronAPI.on(EVT_DL_COMPLETE, (_: any) => {
      setProgress({ phase: 'launch', percent: 100, message: '실행 준비 완료' });
    });

    const offGameStarted = window.electronAPI.on(EVT_GAME_STARTED, () => {
      setTimeout(() => hide(), 500);
    });

    return () => {
      offDlProgress();
      offDlFileProgress();
      offGameDl();
      offError();
      offComplete();
      offGameStarted();
    };
  }, [visible, show, hide, setProgress]);
}
