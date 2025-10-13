/**
 * Hook for managing launcher updates
 */

import { useState, useEffect } from 'react';

export interface LauncherUpdateInfo {
  version: string;
  releaseNotes: string;
  releaseDate: string;
  required: boolean;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export function useLauncherUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<LauncherUpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Update available
    const handleUpdateAvailable = (_event: any, info: LauncherUpdateInfo) => {
      console.log('[LauncherUpdate] Update available:', info);
      setUpdateAvailable(true);
      setUpdateInfo(info);
      setError(null);
    };

    // Update not available
    const handleUpdateNotAvailable = (_event: any, info: { version: string }) => {
      console.log('[LauncherUpdate] No update available:', info.version);
      setUpdateAvailable(false);
      setUpdateInfo(null);
      setChecking(false);
    };

    // Download progress
    const handleDownloadProgress = (_event: any, progress: DownloadProgress) => {
      console.log('[LauncherUpdate] Download progress:', progress.percent);
      setDownloadProgress(progress);
      setIsDownloading(true);
    };

    // Update downloaded
    const handleUpdateDownloaded = (_event: any, info: { version: string }) => {
      console.log('[LauncherUpdate] Update downloaded:', info.version);
      setUpdateDownloaded(true);
      setIsDownloading(false);
      setDownloadProgress(null);
    };

    // Error
    const handleUpdateError = (_event: any, info: { message: string }) => {
      console.error('[LauncherUpdate] Error:', info.message);
      setError(info.message);
      setIsDownloading(false);
      setChecking(false);
    };

    // Register listeners
    window.electronAPI.on('launcher:update-available', handleUpdateAvailable);
    window.electronAPI.on('launcher:update-not-available', handleUpdateNotAvailable);
    window.electronAPI.on('launcher:download-progress', handleDownloadProgress);
    window.electronAPI.on('launcher:update-downloaded', handleUpdateDownloaded);
    window.electronAPI.on('launcher:update-error', handleUpdateError);

    // Check for updates on mount
    checkForUpdates();

    // Check every 4 hours
    const interval = setInterval(() => {
      checkForUpdates();
    }, 4 * 60 * 60 * 1000);

    return () => {
      clearInterval(interval);
      window.electronAPI.off('launcher:update-available', handleUpdateAvailable);
      window.electronAPI.off('launcher:update-not-available', handleUpdateNotAvailable);
      window.electronAPI.off('launcher:download-progress', handleDownloadProgress);
      window.electronAPI.off('launcher:update-downloaded', handleUpdateDownloaded);
      window.electronAPI.off('launcher:update-error', handleUpdateError);
    };
  }, []);

  const checkForUpdates = async () => {
    try {
      setChecking(true);
      setError(null);
      await window.electronAPI.launcher.checkForUpdates();
    } catch (err) {
      console.error('[LauncherUpdate] Check failed:', err);
      setError(err instanceof Error ? err.message : '업데이트 확인 실패');
      setChecking(false);
    }
  };

  const downloadUpdate = async () => {
    try {
      setError(null);
      await window.electronAPI.launcher.downloadUpdate();
    } catch (err) {
      console.error('[LauncherUpdate] Download failed:', err);
      setError(err instanceof Error ? err.message : '다운로드 실패');
    }
  };

  const installUpdate = () => {
    try {
      window.electronAPI.launcher.quitAndInstall();
    } catch (err) {
      console.error('[LauncherUpdate] Install failed:', err);
      setError(err instanceof Error ? err.message : '설치 실패');
    }
  };

  const dismissUpdate = () => {
    setUpdateAvailable(false);
    setUpdateInfo(null);
  };

  const formatBytes = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    const mbps = bytesPerSecond / (1024 * 1024);
    return `${mbps.toFixed(2)} MB/s`;
  };

  return {
    updateAvailable,
    updateInfo,
    isDownloading,
    downloadProgress,
    updateDownloaded,
    error,
    checking,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
    formatBytes,
    formatSpeed
  };
}
