/**
 * Hook for checking and managing HyeniHelper updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';

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
  serverAddress?: string;
  autoCheck?: boolean;
  checkInterval?: number; // in milliseconds
}

export function useHyeniUpdate({
  profilePath,
  gameVersion,
  loaderType,
  serverAddress,
  autoCheck = true,
  checkInterval = 30 * 60 * 1000 // 30 minutes
}: UseHyeniUpdateOptions) {
  const [updateInfo, setUpdateInfo] = useState<HyeniUpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Use ref to store the latest checkForUpdate function
  const checkForUpdateRef = useRef<() => Promise<void>>();

  const checkForUpdate = useCallback(async () => {
    if (!profilePath || !gameVersion || !loaderType) {
      console.log('[useHyeniUpdate] Missing required parameters');
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      console.log('[useHyeniUpdate] Checking for updates...');
      
      const info = await window.electronAPI.hyeni.checkForUpdate(
        profilePath,
        gameVersion,
        loaderType,
        serverAddress
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
  }, [profilePath, gameVersion, loaderType, serverAddress]);
  
  // Update ref whenever checkForUpdate changes
  useEffect(() => {
    checkForUpdateRef.current = checkForUpdate;
  }, [checkForUpdate]);

  // Auto check on mount and interval
  useEffect(() => {
    if (autoCheck) {
      checkForUpdate();

      const interval = setInterval(() => {
        checkForUpdate();
      }, checkInterval);

      return () => clearInterval(interval);
    }
  }, [checkForUpdate, autoCheck, checkInterval]);

  // Listen for mod updates from game launch
  // Only register once on mount, use ref to call the latest checkForUpdate
  useEffect(() => {
    const handleModUpdateComplete = (data: { profileId: string; updatedMods: any[] }) => {
      console.log('[useHyeniUpdate] Mod update completed during game launch, refreshing...', data);
      // Call the latest checkForUpdate via ref
      checkForUpdateRef.current?.();
    };

    // Use the cleanup function returned by 'on' instead of 'off'
    const cleanup = window.electronAPI.on('mod:update-complete', handleModUpdateComplete);

    return cleanup;
  }, []); // Empty dependency - only register once

  return {
    updateInfo,
    isChecking,
    lastCheck,
    error,
    checkForUpdate,
    clearUpdate: () => setUpdateInfo(null)
  };
}
