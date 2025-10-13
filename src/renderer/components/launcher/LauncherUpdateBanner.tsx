/**
 * Launcher Update Banner Component
 * 
 * Global banner shown at the top when launcher update is available
 */

import React from 'react';
import { Download, Loader2, Rocket, X } from 'lucide-react';
import type { LauncherUpdateInfo, DownloadProgress } from '../../hooks/useLauncherUpdate';

interface LauncherUpdateBannerProps {
  updateInfo: LauncherUpdateInfo;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  updateDownloaded: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bytesPerSecond: number) => string;
}

export function LauncherUpdateBanner({
  updateInfo,
  isDownloading,
  downloadProgress,
  updateDownloaded,
  onDownload,
  onInstall,
  onDismiss,
  formatBytes,
  formatSpeed
}: LauncherUpdateBannerProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Info */}
          <div className="flex items-center gap-3 flex-1">
            <Rocket className="w-5 h-5 animate-bounce flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm sm:text-base truncate">
                🎉 HyeniMC v{updateInfo.version} 업데이트
              </h3>
              <p className="text-xs sm:text-sm text-blue-100 truncate">
                {updateInfo.releaseNotes || '새로운 기능 및 개선사항'}
              </p>
            </div>
          </div>

          {/* Center: Progress (only when downloading) */}
          {isDownloading && downloadProgress && (
            <div className="hidden md:flex items-center gap-3 flex-shrink-0">
              <div className="text-xs text-right">
                <div className="font-medium">{downloadProgress.percent}%</div>
                <div className="text-blue-200">
                  {formatSpeed(downloadProgress.bytesPerSecond)}
                </div>
              </div>
              <div className="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
              <div className="text-xs text-blue-200 whitespace-nowrap">
                {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
              </div>
            </div>
          )}

          {/* Right: Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {updateDownloaded ? (
              // Install button
              <button
                onClick={onInstall}
                className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">재시작하여 적용</span>
                <span className="sm:hidden">재시작</span>
              </button>
            ) : isDownloading ? (
              // Downloading state
              <div className="px-4 py-2 bg-white/20 rounded-lg flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">다운로드 중...</span>
                <span className="sm:hidden">{downloadProgress?.percent}%</span>
              </div>
            ) : (
              // Download button
              <button
                onClick={onDownload}
                className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium text-sm flex items-center gap-2 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">지금 업데이트</span>
                <span className="sm:hidden">업데이트</span>
              </button>
            )}

            {/* Dismiss button (only if not required and not downloading) */}
            {!updateInfo.required && !isDownloading && !updateDownloaded && (
              <button
                onClick={onDismiss}
                className="p-2 hover:bg-white/10 rounded transition-colors"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile progress (shown on small screens when downloading) */}
        {isDownloading && downloadProgress && (
          <div className="md:hidden mt-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>{downloadProgress.percent}%</span>
              <span className="text-blue-200">
                {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
              </span>
            </div>
            <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-300"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
