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
    console.log('[LauncherUpdate] Registering event listeners...');
    
    // Update available
    const handleUpdateAvailable = (info: LauncherUpdateInfo) => {
      console.log('[LauncherUpdate] ✅ Update available event received:', info);
      setUpdateAvailable(true);
      setUpdateInfo(info);
      setError(null);
      setChecking(false);
    };

    // Update not available
    const handleUpdateNotAvailable = (info: { version: string }) => {
      console.log('[LauncherUpdate] ℹ️ No update available:', info.version);
      setUpdateAvailable(false);
      setUpdateInfo(null);
      setChecking(false);
    };

    // Download progress
    const handleDownloadProgress = (progress: DownloadProgress) => {
      console.log('[LauncherUpdate] 📥 Download progress:', progress.percent + '%');
      setDownloadProgress(progress);
      setIsDownloading(true);
    };

    // Update downloaded
    const handleUpdateDownloaded = (info: { version: string }) => {
      console.log('[LauncherUpdate] ✅ Update downloaded:', info.version);
      setUpdateDownloaded(true);
      setIsDownloading(false);
      setDownloadProgress(null);
    };

    // Error
    const handleUpdateError = (info: { message: string }) => {
      console.error('[LauncherUpdate] ❌ Error:', info.message);
      setError(info.message);
      setIsDownloading(false);
      setChecking(false);
    };

    // Register listeners - use cleanup functions returned by 'on'
    const cleanup1 = window.electronAPI.on('launcher:update-available', handleUpdateAvailable);
    const cleanup2 = window.electronAPI.on('launcher:update-not-available', handleUpdateNotAvailable);
    const cleanup3 = window.electronAPI.on('launcher:download-progress', handleDownloadProgress);
    const cleanup4 = window.electronAPI.on('launcher:update-downloaded', handleUpdateDownloaded);
    const cleanup5 = window.electronAPI.on('launcher:update-error', handleUpdateError);

    // Check for updates on mount
    checkForUpdates();

    // Check every 4 hours
    const interval = setInterval(() => {
      checkForUpdates();
    }, 4 * 60 * 60 * 1000);

    return () => {
      clearInterval(interval);
      cleanup1();
      cleanup2();
      cleanup3();
      cleanup4();
      cleanup5();
    };
  }, []);

  const checkForUpdates = async () => {
    try {
      console.log('[LauncherUpdate] 🔍 Checking for updates...');
      setChecking(true);
      setError(null);
      await (window.electronAPI as any).launcher?.checkForUpdates();
      console.log('[LauncherUpdate] ✅ Check request sent');
    } catch (err) {
      console.error('[LauncherUpdate] ❌ Check failed:', err);
      setError(err instanceof Error ? err.message : '업데이트 확인 실패');
      setChecking(false);
    }
  };

  const downloadUpdate = async () => {
    try {
      console.log('[LauncherUpdate] 📥 Starting download...');
      setError(null);
      await (window.electronAPI as any).launcher?.downloadUpdate();
    } catch (err) {
      console.error('[LauncherUpdate] ❌ Download failed:', err);
      setError(err instanceof Error ? err.message : '다운로드 실패');
    }
  };

  const installUpdate = () => {
    try {
      console.log('[LauncherUpdate] 🔄 Installing update and restarting...');
      (window.electronAPI as any).launcher?.quitAndInstall();
    } catch (err) {
      console.error('[LauncherUpdate] ❌ Install failed:', err);
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
