/**
 * Worker Mod Update Panel
 * 
 * Displays available updates for multiple mods and allows batch installation
 */

import React, { useState, useMemo } from 'react';
import { ModUpdateItem } from './ModUpdateItem';
import type { WorkerModUpdateCheck } from '../../../shared/types/worker-mods';

interface WorkerModUpdatePanelProps {
  updates: WorkerModUpdateCheck[];
  isInstalling: boolean;
  installProgress: Map<string, number>;
  onInstall: (selectedModIds: string[]) => void;
  onDismiss: () => void;
}

export const WorkerModUpdatePanel: React.FC<WorkerModUpdatePanelProps> = ({
  updates,
  isInstalling,
  installProgress,
  onInstall,
  onDismiss
}) => {
  // 설치된 업데이트 + 신규 필수 모드는 기본 선택(서버 접속에 필요하므로 자동 체크)
  const [selectedMods, setSelectedMods] = useState<Set<string>>(
    new Set(
      updates
        .filter(u => u.isInstalled || u.category === 'required')
        .map(u => u.modId)
    )
  );

  // Categorize updates
  const installedUpdates = useMemo(
    () => updates.filter(u => u.isInstalled),
    [updates]
  );
  
  const newRequiredMods = useMemo(
    () => updates.filter(u => !u.isInstalled && u.category === 'required'),
    [updates]
  );
  
  const newOptionalMods = useMemo(
    () => updates.filter(u => !u.isInstalled && u.category === 'optional'),
    [updates]
  );

  const loaderChange = useMemo(
    () => updates.find(u => u.requiredLoaderVersion)?.requiredLoaderVersion ?? null,
    [updates]
  );

  const toggleMod = (modId: string) => {
    setSelectedMods(prev => {
      const next = new Set(prev);
      if (next.has(modId)) {
        next.delete(modId);
      } else {
        next.add(modId);
      }
      return next;
    });
  };

  const handleInstall = () => {
    onInstall(Array.from(selectedMods));
  };

  const selectAll = () => {
    setSelectedMods(new Set(updates.map(u => u.modId)));
  };

  const deselectOptional = () => {
    setSelectedMods(new Set([
      ...installedUpdates.map(u => u.modId),
      ...newRequiredMods.map(u => u.modId)
    ]));
  };

  if (updates.length === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border-2 border-purple-500/50 rounded-xl p-6 space-y-4 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            ✨ {updates.length}개의 모드 업데이트 사용 가능
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {installedUpdates.length > 0 && `${installedUpdates.length}개 업데이트`}
            {installedUpdates.length > 0 && (newRequiredMods.length + newOptionalMods.length) > 0 && ', '}
            {(newRequiredMods.length + newOptionalMods.length) > 0 &&
              `${newRequiredMods.length + newOptionalMods.length}개 신규`}
          </p>
          {loaderChange && (
            <p className="text-sm text-amber-300 mt-1 flex items-center gap-1">
              🔧 모드 로더도 함께 업데이트됩니다 <span className="font-mono">(→ {loaderChange})</span>
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {!isInstalling && (
            <>
              <button
                onClick={deselectOptional}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                필수만
              </button>
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                모두 선택
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                나중에
              </button>
              <button
                onClick={handleInstall}
                disabled={selectedMods.size === 0}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                업데이트 ({selectedMods.size}개)
              </button>
            </>
          )}
          
          {isInstalling && (
            <div className="flex items-center gap-2 text-purple-400">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-purple-400 border-t-transparent" />
              <span className="font-semibold">설치 중...</span>
            </div>
          )}
        </div>
      </div>

      {/* Installed Mods Updates */}
      {installedUpdates.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
            🔄 설치된 모드 업데이트 ({installedUpdates.length})
            <span className="text-xs text-gray-400 font-normal">
              • 자동으로 업데이트됩니다
            </span>
          </h4>
          <div className="space-y-2">
            {installedUpdates.map(mod => (
              <ModUpdateItem
                key={mod.modId}
                mod={mod}
                selected={selectedMods.has(mod.modId)}
                onToggle={() => {}} // No-op, cannot toggle installed mods
                disabled={true}
                progress={installProgress.get(mod.modId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* New Required Mods */}
      {newRequiredMods.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2">
            🔴 필수 모드 ({newRequiredMods.length})
            <span className="text-xs text-gray-400 font-normal">
              • 서버 접속에 필요합니다
            </span>
          </h4>
          <div className="space-y-2">
            {newRequiredMods.map(mod => (
              <ModUpdateItem
                key={mod.modId}
                mod={mod}
                selected={selectedMods.has(mod.modId)}
                onToggle={() => toggleMod(mod.modId)}
                disabled={isInstalling}
                progress={installProgress.get(mod.modId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* New Optional Mods */}
      {newOptionalMods.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
            ⚪ 선택 모드 ({newOptionalMods.length})
            <span className="text-xs text-gray-500 font-normal">
              • 원하는 모드만 선택하세요
            </span>
          </h4>
          <div className="space-y-2">
            {newOptionalMods.map(mod => (
              <ModUpdateItem
                key={mod.modId}
                mod={mod}
                selected={selectedMods.has(mod.modId)}
                onToggle={() => toggleMod(mod.modId)}
                disabled={isInstalling}
                progress={installProgress.get(mod.modId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
