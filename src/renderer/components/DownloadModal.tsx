import React from 'react';
import { Loader2, Download } from 'lucide-react';

interface DownloadModalProps {
  isOpen: boolean;
  versionId: string;
  progress?: {
    downloaded: number;
    total: number;
    progress: number;
    speed: number;
    phase?: string;
    totalAssets?: number;
    completedAssets?: number;
    completedTasks?: number;
    totalTasks?: number;
    overallProgress?: number;
    modName?: string;
    modProgress?: number;
    totalMods?: number;
    completedMods?: number;
  };
  status: 'downloading' | 'extracting' | 'error';
  error?: string;
}

export function DownloadModal({ isOpen, versionId, progress, status, error }: DownloadModalProps) {
  if (!isOpen) return null;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="card max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            {status === 'error' ? (
              <span className="text-2xl">⚠️</span>
            ) : (
              <Download className="w-6 h-6 animate-bounce" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold">
              {status === 'error' ? '다운로드 실패' : '게임 다운로드 중'}
            </h2>
            <p className="text-sm text-gray-400">Minecraft {versionId}</p>
          </div>
        </div>

        {status === 'error' ? (
          /* Error State */
          <div className="space-y-4">
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-300">{error || '알 수 없는 오류가 발생했습니다'}</p>
            </div>
            <p className="text-xs text-gray-500">
              네트워크 연결을 확인하고 다시 시도해주세요.
            </p>
          </div>
        ) : (
          /* Progress State */
          <div className="space-y-4">
            {/* Mod Update Progress */}
            {progress?.modName && (
              <div className="bg-hyeni-pink-900/20 border-2 border-hyeni-pink-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">✨</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-hyeni-pink-300">필수 모드 업데이트 중</p>
                    <p className="text-xs text-gray-400">{progress.modName}</p>
                  </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div
                    className="bg-gradient-to-r from-hyeni-pink-500 to-purple-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress.modProgress || 0}%` }}
                  />
                </div>
                <div className="text-right mt-1">
                  <span className="text-xs text-hyeni-pink-400 font-medium">
                    {progress.modProgress?.toFixed(0) || 0}%
                  </span>
                </div>
              </div>
            )}

            {/* Overall Progress */}
            {progress?.totalTasks && progress.totalTasks > 0 && !progress.modName && (
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400 font-medium">전체 진행률</span>
                  <span className="font-bold text-purple-400">
                    {progress.completedTasks || 0} / {progress.totalTasks} 파일
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${progress.overallProgress || 0}%` }}
                  />
                </div>
                <div className="text-right mt-1">
                  <span className="text-xs text-gray-500">
                    {progress.overallProgress?.toFixed(1) || 0}%
                  </span>
                </div>
              </div>
            )}

            {/* Current File Progress */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">
                  {status === 'downloading' ? '현재 파일' : 'Native 라이브러리 추출 중...'}
                </span>
                <span className="font-medium">{progress?.progress?.toFixed(1) || 0}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress?.progress || 0}%` }}
                />
              </div>
            </div>

            {/* Download Stats */}
            {progress && (
              <div className="text-sm text-gray-400 space-y-2">
                <div className="flex justify-between">
                  <span>다운로드 속도:</span>
                  <span className="text-white font-medium">{formatSpeed(progress.speed || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>현재 파일 크기:</span>
                  <span className="text-white font-medium">
                    {formatBytes(progress.downloaded || 0)} / {formatBytes(progress.total || 0)}
                  </span>
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 mt-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                {status === 'downloading' 
                  ? '🚀 병렬 다운로드로 빠르게 게임 파일을 받고 있습니다. 네트워크 상태에 따라 수 분이 소요될 수 있습니다.'
                  : '⚙️ Native 라이브러리를 추출하고 게임을 실행할 준비를 하고 있습니다.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
