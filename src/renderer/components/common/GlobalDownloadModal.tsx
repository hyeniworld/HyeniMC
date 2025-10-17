import React from 'react';
import { useDownloadStore } from '../../store/downloadStore';
import { DownloadModal as RichDownloadModal } from '../DownloadModal';

function parseSpeedToBps(speed?: string | number): number {
  if (speed == null) return 0;
  // If backend already gives B/s number
  if (typeof speed === 'number' && isFinite(speed)) return Math.max(0, speed);
  const s = String(speed).trim();
  // Accept formats like "3.71 KB/s", "1.2MB/s", "1024 B/s"
  const m = s.match(/([0-9]+\.?[0-9]*)\s*(B|KB|MB|GB)\s*\/\s*s/i);
  if (!m) {
    const numeric = parseFloat(s);
    return isFinite(numeric) ? Math.max(0, numeric) : 0;
  }
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const factor = unit === 'GB' ? 1024 * 1024 * 1024 : unit === 'MB' ? 1024 * 1024 : unit === 'KB' ? 1024 : 1;
  return Math.max(0, value * factor);
}

export const GlobalDownloadModal: React.FC = () => {
  const {
    visible,
    versionId,
    percent,
    speed,
    currentFile,
    totalBytes,
    transferredBytes,
    totalTasks,
    completedTasks,
    currentFileDownloaded,
    currentFileTotal,
    error,
    hide,
    reset,
  } = useDownloadStore();

  if (!visible && !error) return null;

  // Build rich modal props
  // Current-file metrics (preferred)
  const downloaded = Math.max(0, currentFileDownloaded ?? 0);
  const total = Math.max(downloaded, currentFileTotal ?? 0);
  const currentProgress = total > 0 ? (downloaded / total) * 100 : (percent ?? 0);
  // Overall progress for header section
  const overallProgress = totalTasks && completedTasks ? (completedTasks / totalTasks) * 100 : (percent ?? 0);

  const progress = {
    downloaded,
    total,
    progress: currentProgress,
    speed: parseSpeedToBps(speed),
    totalTasks: totalTasks as any,
    completedTasks: completedTasks as any,
    overallProgress,
    phase: currentFile || undefined,
  };

  const handleClose = () => {
    reset();
  };

  return (
    <RichDownloadModal
      isOpen={!!visible || !!error}
      versionId={versionId || ''}
      progress={progress as any}
      status={error ? 'error' : 'downloading'}
      error={error}
      onClose={handleClose}
    />
  );
};
