/**
 * Launcher Update Modal Component
 * 
 * Modal dialog for important/required updates
 */

import React from 'react';
import { Download, Loader2, Sparkles, X } from 'lucide-react';
import type { LauncherUpdateInfo, DownloadProgress } from '../../hooks/useLauncherUpdate';

interface LauncherUpdateModalProps {
  updateInfo: LauncherUpdateInfo;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  updateDownloaded: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss?: () => void;
  formatBytes: (bytes: number) => string;
}

export function LauncherUpdateModal({
  updateInfo,
  isDownloading,
  downloadProgress,
  updateDownloaded,
  onDownload,
  onInstall,
  onDismiss,
  formatBytes
}: LauncherUpdateModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 m-4 relative">
        {/* Close button (only if not required) */}
        {!updateInfo.required && onDismiss && !isDownloading && !updateDownloaded && (
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            HyeniMC 업데이트
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            v{updateInfo.version}
          </p>
        </div>

        {/* Release notes */}
        {updateInfo.releaseNotes && (
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-4">
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-white text-sm">
              ✨ 새로운 기능
            </h3>
            <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {updateInfo.releaseNotes}
            </div>
          </div>
        )}

        {/* Progress bar */}
        {isDownloading && downloadProgress && (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600 dark:text-gray-400">다운로드 중...</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {downloadProgress.percent}%
              </span>
            </div>
            <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 text-center">
              {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
            </p>
          </div>
        )}

        {/* Required badge */}
        {updateInfo.required && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium text-center">
              ⚠️ 이 업데이트는 필수입니다. 계속 사용하려면 업데이트하세요.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {updateDownloaded ? (
            // Install button
            <button
              onClick={onInstall}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all font-medium flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              재시작하여 적용
            </button>
          ) : isDownloading ? (
            // Downloading state
            <button
              disabled
              className="flex-1 px-4 py-3 bg-gray-400 text-white rounded-lg cursor-not-allowed font-medium flex items-center justify-center gap-2"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              다운로드 중...
            </button>
          ) : (
            <>
              {/* Download button */}
              <button
                onClick={onDownload}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all font-medium flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                업데이트하고 재시작
              </button>
              
              {/* Later button (only if not required) */}
              {!updateInfo.required && onDismiss && (
                <button
                  onClick={onDismiss}
                  className="px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                >
                  나중에
                </button>
              )}
            </>
          )}
        </div>

        {/* Info text */}
        <p className="text-xs text-gray-500 dark:text-gray-500 text-center mt-4">
          업데이트는 백그라운드에서 다운로드되며, 완료 후 자동으로 적용됩니다.
        </p>
      </div>
    </div>
  );
}
