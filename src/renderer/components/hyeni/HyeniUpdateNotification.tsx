/**
 * HyeniHelper Update Notification Component
 * 
 * Displays update notification banner when a new version is available
 */

import React, { useState } from 'react';
import { Download, Loader2, Sparkles, X } from 'lucide-react';

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

interface HyeniUpdateNotificationProps {
  profileId: string;
  profilePath: string;
  gameVersion: string;
  loaderType: string;
  updateInfo: HyeniUpdateInfo | null;
  onUpdateComplete?: () => void;
  onDismiss?: () => void;
}

export function HyeniUpdateNotification({
  profilePath,
  updateInfo,
  onUpdateComplete,
  onDismiss
}: HyeniUpdateNotificationProps) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!updateInfo || !updateInfo.available) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    setError(null);
    setProgress(0);

    try {
      // Listen for progress updates
      const progressListener = (progressValue: number) => {
        setProgress(progressValue);
      };
      
      // @deprecated - 이 컴포넌트는 더 이상 사용되지 않음 (레거시)
      const cleanup = window.electronAPI.on('hyeni:update-progress', progressListener);

      // Install update
      const result = await window.electronAPI.hyeni.installUpdate(profilePath, updateInfo);

      // Cleanup listener
      cleanup();

      if (result.success) {
        console.log('[HyeniUpdate] Update installed successfully');
        onUpdateComplete?.();
      } else {
        setError(result.message || '업데이트 설치에 실패했습니다.');
      }
    } catch (err) {
      console.error('[HyeniUpdate] Failed to install update:', err);
      setError(err instanceof Error ? err.message : '업데이트 설치 중 오류가 발생했습니다.');
    } finally {
      setIsInstalling(false);
      setProgress(0);
    }
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-purple-500/10 border border-purple-500/50 rounded-lg p-4 mb-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-pink-500/5 to-purple-500/5 animate-pulse"></div>
      
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-purple-500 animate-pulse" />
              <h3 className="font-semibold text-purple-600 dark:text-purple-400">
                🎉 HyeniHelper 업데이트 available!
              </h3>
            </div>

            {/* Version info */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {updateInfo.currentVersion ? (
                  <>
                    <span className="font-mono">{updateInfo.currentVersion}</span>
                    <span className="mx-2">→</span>
                    <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                      {updateInfo.latestVersion}
                    </span>
                  </>
                ) : (
                  <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                    {updateInfo.latestVersion} (새로 설치)
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                ({formatSize(updateInfo.size)})
              </span>
            </div>

            {/* Changelog */}
            {updateInfo.changelog && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 bg-white/50 dark:bg-gray-800/50 rounded p-2">
                {updateInfo.changelog}
              </p>
            )}

            {/* Required badge */}
            {updateInfo.required && (
              <div className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold rounded mb-3">
                필수 업데이트
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/50 rounded text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Progress bar */}
            {isInstalling && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                  <span>다운로드 중...</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="btn-primary flex items-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isInstalling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden sm:inline">설치 중...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">업데이트</span>
                </>
              )}
            </button>

            {!updateInfo.required && !isInstalling && (
              <button
                onClick={onDismiss}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                title="닫기"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
