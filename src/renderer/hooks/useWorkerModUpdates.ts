/**
 * Hook for checking and managing Worker Mods updates (multi-mod system)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkerModUpdateCheck } from '../../shared/types/worker-mods';

interface UseWorkerModUpdatesOptions {
  profilePath: string;
  gameVersion: string;
  loaderType: string;
  serverAddress?: string;
  autoCheck?: boolean;
  checkInterval?: number; // in milliseconds
}

export function useWorkerModUpdates({
  profilePath,
  gameVersion,
  loaderType,
  serverAddress,
  autoCheck = true,
  checkInterval = 30 * 60 * 1000 // 30 minutes
}: UseWorkerModUpdatesOptions) {
  const [updates, setUpdates] = useState<WorkerModUpdateCheck[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<Map<string, number>>(new Map());
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ref to store latest checkForUpdates function
  const checkForUpdatesRef = useRef<() => Promise<void>>();

  const checkForUpdates = useCallback(async () => {
    if (!profilePath || !gameVersion || !loaderType) {
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      const result = await window.electronAPI.workerMods.checkUpdates(
        profilePath,
        gameVersion,
        loaderType,
        serverAddress
      );

      setUpdates(result);
      setLastCheck(new Date());

      if (result.length > 0) {
        console.log(`[Worker Mods] ${result.length}개 업데이트 발견`);
      }
    } catch (err) {
      console.error('[Worker Mods] 업데이트 확인 실패:', err);
      setError(err instanceof Error ? err.message : '업데이트 확인에 실패했습니다.');
      setUpdates([]);
    } finally {
      setIsChecking(false);
    }
  }, [profilePath, gameVersion, loaderType, serverAddress]);

  // Update ref whenever checkForUpdates changes
  useEffect(() => {
    checkForUpdatesRef.current = checkForUpdates;
  }, [checkForUpdates]);

  // Auto check on mount and interval
  useEffect(() => {
    if (autoCheck) {
      checkForUpdates();

      const interval = setInterval(() => {
        checkForUpdates();
      }, checkInterval);

      return () => clearInterval(interval);
    }
  }, [checkForUpdates, autoCheck, checkInterval]);

  // Listen for update completion events
  useEffect(() => {
    const cleanup = window.electronAPI.on('worker-mods:update-complete', () => {
      console.log('[useWorkerModUpdates] Update completed, refreshing...');
      checkForUpdatesRef.current?.();
    });

    return cleanup;
  }, []);

  // Install selected mods
  const installSelected = useCallback(async (selectedModIds: string[]) => {
    const selectedUpdates = updates.filter(u => selectedModIds.includes(u.modId));
    
    if (selectedUpdates.length === 0) {
      return;
    }
    
    setIsInstalling(true);
    setInstallProgress(new Map());
    setError(null);

    try {
      // Listen for progress updates
      const progressCleanup = window.electronAPI.on('worker-mods:install-progress', 
        (data: { modId: string; progress: number }) => {
          setInstallProgress(prev => new Map(prev).set(data.modId, data.progress));
        }
      );

      const results = await window.electronAPI.workerMods.installMultiple(
        profilePath,
        selectedUpdates
      );

      progressCleanup();

      // Check for failures
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        const errorMsg = `${failures.length}개 모드 설치 실패: ${failures.map(f => f.modId).join(', ')}`;
        setError(errorMsg);
        console.error('[Worker Mods]', errorMsg);
      } else {
        console.log(`[Worker Mods] ${results.length}개 모드 설치 완료`);
      }

      // Refresh updates list
      await checkForUpdates();
    } catch (err) {
      console.error('[Worker Mods] 모드 설치 실패:', err);
      setError(err instanceof Error ? err.message : '모드 설치에 실패했습니다.');
    } finally {
      setIsInstalling(false);
      setInstallProgress(new Map());
    }
  }, [updates, profilePath, checkForUpdates]);

  return {
    updates,
    isChecking,
    isInstalling,
    installProgress,
    lastCheck,
    error,
    checkForUpdates,
    installSelected,
    clearError: () => setError(null),
    clearUpdates: () => setUpdates([]),
    
    // Computed values
    hasUpdates: updates.length > 0,
    installedUpdates: updates.filter(u => u.isInstalled),
    newRequiredMods: updates.filter(u => !u.isInstalled && u.category === 'required'),
    newOptionalMods: updates.filter(u => !u.isInstalled && u.category === 'optional'),
  };
}
