/**
 * Individual mod update item component
 */

import React from 'react';
import type { WorkerModUpdateCheck } from '../../../shared/types/worker-mods';

interface ModUpdateItemProps {
  mod: WorkerModUpdateCheck;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  progress?: number;
}

export const ModUpdateItem: React.FC<ModUpdateItemProps> = ({
  mod,
  selected,
  onToggle,
  disabled = false,
  progress
}) => {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusText = (): string => {
    if (progress !== undefined) {
      if (progress === 100) return '✅ 완료';
      if (progress > 0) return `⏳ ${progress}%`;
      return '⏸ 대기 중';
    }
    
    if (mod.isInstalled) {
      return `${mod.currentVersion} → ${mod.latestVersion}`;
    }
    
    return '신규 설치';
  };

  const getCategoryBadge = (): React.ReactNode => {
    if (mod.isInstalled) {
      return null; // Don't show badge for installed mods
    }
    
    if (mod.category === 'required') {
      return (
        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
          필수
        </span>
      );
    }
    
    return (
      <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded">
        선택
      </span>
    );
  };

  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg transition-all
        ${selected ? 'bg-purple-500/10 border border-purple-500/30' : 'bg-gray-800/30 border border-transparent'}
        ${disabled ? 'opacity-60' : 'hover:bg-gray-800/50 cursor-pointer'}
      `}
      onClick={() => !disabled && onToggle()}
    >
      {/* Checkbox */}
      <div className="flex-shrink-0">
        <div
          className={`
            w-5 h-5 rounded border-2 flex items-center justify-center transition-all
            ${selected ? 'bg-purple-600 border-purple-600' : 'border-gray-600'}
            ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Mod Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-semibold text-white truncate">
            {mod.name}
          </h4>
          {getCategoryBadge()}
        </div>
        
        {mod.changelog && (
          <p className="text-sm text-gray-400 truncate">
            • {mod.changelog}
          </p>
        )}
        
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>📦 {formatSize(mod.size)}</span>
          <span>🎮 {mod.gameVersion}</span>
          <span>🔧 {mod.loader}</span>
        </div>
      </div>

      {/* Version / Status */}
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-medium text-gray-300">
          {getStatusText()}
        </div>
        
        {progress !== undefined && progress > 0 && progress < 100 && (
          <div className="w-24 h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
