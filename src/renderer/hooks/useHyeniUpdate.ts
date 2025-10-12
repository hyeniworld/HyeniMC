/**
 * Hook for checking and managing HyeniHelper updates
 */

import { useState, useEffect } from 'react';

interface HyeniUpdateInfo {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  required: boolean;
  gameVersion: string;
  loader: string;
}

interface UseHyeniUpdateOptions {
  profilePath: string;
  gameVersion: string;
  loaderType: string;
  autoCheck?: boolean;
  checkInterval?: number; // in milliseconds
}

export function useHyeniUpdate({
  profilePath,
  gameVersion,
  loaderType,
  autoCheck = true,
  checkInterval = 30 * 60 * 1000 // 30 minutes
}: UseHyeniUpdateOptions) {
  const [updateInfo, setUpdateInfo] = useState<HyeniUpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = async () => {
    if (!profilePath || !gameVersion || !loaderType) {
      console.log('[useHyeniUpdate] Missing required parameters');
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      console.log('[useHyeniUpdate] Checking for updates...');
      
      const info = await window.electronAPI.hyeni.checkUpdate(
        profilePath,
        gameVersion,
        loaderType
      );

      setUpdateInfo(info);
      setLastCheck(new Date());

      if (info) {
        console.log(`[useHyeniUpdate] Update available: ${info.latestVersion}`);
      } else {
        console.log('[useHyeniUpdate] No update available');
      }
    } catch (err) {
      console.error('[useHyeniUpdate] Failed to check for updates:', err);
      setError(err instanceof Error ? err.message : '업데이트 확인에 실패했습니다.');
      setUpdateInfo(null);
    } finally {
      setIsChecking(false);
    }
  };

  // Auto check on mount and interval
  useEffect(() => {
    if (autoCheck) {
      checkForUpdate();

      const interval = setInterval(() => {
        checkForUpdate();
      }, checkInterval);

      return () => clearInterval(interval);
    }
  }, [profilePath, gameVersion, loaderType, autoCheck, checkInterval]);

  return {
    updateInfo,
    isChecking,
    lastCheck,
    error,
    checkForUpdate,
    clearUpdate: () => setUpdateInfo(null)
  };
}
