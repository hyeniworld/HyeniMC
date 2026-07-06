import React, { useState, useEffect, useRef } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { ModSearchModal } from './ModSearchModal';
import { isCreatorMode } from '../../utils/appMode';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface ModUpdateInfo {
  modId: string;
  modName: string;
  fileName: string;
  currentVersion: string;
  latestVersion: string;
  latestVersionId: string;
  changelog?: string;
  required: boolean;
  downloadUrl: string;
  fileSize: number;
  source: 'modrinth' | 'curseforge';
}

interface Mod {
  id: string;
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  enabled: boolean;
  loader: string;
  fileName: string;
  source?: 'modrinth' | 'curseforge' | 'local';
  sourceModId?: string;
  sourceFileId?: string;
  // 업데이트 정보
  hasUpdate?: boolean;
  updateInfo?: ModUpdateInfo;
}

interface ModListProps {
  profileId: string;
}

export const ModList: React.FC<ModListProps> = ({ profileId }) => {
  const toast = useToast();
  const [mods, setMods] = useState<Mod[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [updates, setUpdates] = useState<ModUpdateInfo[]>([]);
  const [updatingModIds, setUpdatingModIds] = useState<Set<string>>(new Set());
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // 포커스 복원 헬퍼 함수
  const restoreFocus = () => {
    // 여러 번 재시도하여 포커스 복원 보장
    const attempts = [0, 50, 100, 200, 300];
    attempts.forEach(delay => {
      setTimeout(() => {
        window.focus();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, delay);
    });
  };

  useEffect(() => {
    loadProfile();
    loadMods();
    
    // Start file watcher
    const startWatcher = async () => {
      try {
        const profile = await window.electronAPI.profile.get(profileId);
        await window.electronAPI.fileWatcher.start(profileId, profile.gameDirectory);
      } catch (error) {
        console.error('[ModList] Failed to start file watcher:', error);
      }
    };
    startWatcher();
    
    // Listen for file changes
    const cleanup = window.electronAPI.on('file:changed', async (data: any) => {
      if (data.profileId === profileId && data.type === 'mods') {
        console.log('[ModList] File changed:', data);
        
        // Partial update instead of full reload to prevent flicker
        if (data.action === 'remove') {
          // Remove mod from list immediately
          setMods(prev => prev.filter(mod => mod.fileName !== data.fileName));
        } else if (data.action === 'add' || data.action === 'change') {
          // Reload to get the new/updated mod info
          const modList = await window.electronAPI.mod.list(profileId);
          setMods(modList);
        }
      }
    });
    
    return () => {
      cleanup();
      // Stop file watcher
      window.electronAPI.fileWatcher.stop(profileId).catch(console.error);
    };
  }, [profileId]);

  const loadProfile = async () => {
    try {
      const profiles = await window.electronAPI.profile.list();
      const foundProfile = profiles.find((p: any) => p.id === profileId);
      setProfile(foundProfile || null);
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  };

  const loadMods = async () => {
    setLoading(true);
    try {
      const modList = await window.electronAPI.mod.list(profileId);
      setMods(modList);
    } catch (error) {
      console.error('Failed to load mods:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMod = async (fileName: string, currentEnabled: boolean) => {
    try {
      const newEnabled = !currentEnabled;
      await window.electronAPI.mod.toggle(profileId, fileName, newEnabled);
      // Update state locally instead of reloading
      setMods(prev => prev.map(mod => 
        mod.fileName === fileName ? { ...mod, enabled: newEnabled } : mod
      ));
      restoreFocus();
    } catch (error) {
      console.error('Failed to toggle mod:', error);
      await loadMods(); // Reload on error
      restoreFocus();
    }
  };

  const deleteMod = async (fileName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: '모드 삭제',
      message: '정말 이 모드를 삭제하시겠습니까?',
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        try {
          await window.electronAPI.mod.remove(profileId, fileName);
          setMods(prev => prev.filter(mod => mod.fileName !== fileName));
        } catch (error) {
          console.error('Failed to delete mod:', error);
          await loadMods();
        }
      },
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    console.log('File selected:', file.name);
    toast.info('준비 중', '모드 파일 업로드 기능은 준비 중입니다.');
  };

  const handleCheckUpdates = async () => {
    if (!profile) return;

    setCheckingUpdates(true);
    try {
      const foundUpdates = await window.electronAPI.mod.checkUpdates(
        profileId,
        profile.gameVersion,
        profile.loaderType
      );
      setUpdates(foundUpdates);
      
      // 모드 목록에 업데이트 정보 병합
      setMods(prev => prev.map(mod => {
        const updateInfo = foundUpdates.find((u: ModUpdateInfo) => u.fileName === mod.fileName);
        if (updateInfo) {
          return {
            ...mod,
            hasUpdate: true,
            updateInfo
          };
        }
        return { ...mod, hasUpdate: false, updateInfo: undefined };
      }));
      
      if (foundUpdates.length === 0) {
        toast.success('최신 버전', '모든 모드가 최신 버전입니다!');
      } else {
        toast.success('업데이트 발견', `${foundUpdates.length}개의 업데이트를 찾았습니다!`);
      }
    } catch (error) {
      console.error('Failed to check updates:', error);
      toast.error('업데이트 확인 실패', '업데이트 확인에 실패했습니다.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateSingle = async (mod: Mod) => {
    if (!mod.updateInfo) return;

    if (!confirm(`${mod.name}을(를) ${mod.updateInfo.latestVersion}(으)로 업데이트하시겠습니까?`)) {
      return;
    }

    setUpdatingModIds(prev => new Set(prev).add(mod.fileName));
    try {
      // 개별 업데이트 API 호출
      await window.electronAPI.mod.updateMod(
        profileId,
        mod.updateInfo.modId,
        mod.updateInfo.latestVersionId,
        mod.updateInfo.source
      );

      toast.success('업데이트 완료', `${mod.name}이(가) 성공적으로 업데이트되었습니다.`);
      
      // 업데이트 목록에서 제거
      setUpdates(prev => prev.filter(u => u.fileName !== mod.fileName));
      
      // 모드 목록 새로고침
      await loadMods();
      restoreFocus();
    } catch (error) {
      console.error('Failed to update mod:', error);
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      toast.error('업데이트 실패', `${mod.name}: ${errorMsg}`);
      restoreFocus();
    } finally {
      setUpdatingModIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(mod.fileName);
        return newSet;
      });
    }
  };

  const handleUpdateAll = async () => {
    if (updates.length === 0) return;

    setConfirmDialog({
      isOpen: true,
      title: '모드 업데이트',
      message: `${updates.length}개의 모드를 업데이트하시겠습니까?`,
      onConfirm: async () => {
        setConfirmDialog({ ...confirmDialog, isOpen: false });
        setUpdatingMods(true);
        try {
          const result = await window.electronAPI.mod.updateAll(profileId, updates);
          
          if (result.failed.length === 0) {
            toast.success('전체 업데이트 완료', `${result.success.length}개의 모드가 업데이트되었습니다.`);
          } else {
            toast.warning('업데이트 완료', `성공: ${result.success.length}개, 실패: ${result.failed.length}개`);
          }
          
          setUpdates([]);
          await loadMods();
        } catch (error) {
          console.error('Failed to update mods:', error);
          toast.error('업데이트 실패', '모드 업데이트에 실패했습니다.');
        } finally {
          setUpdatingMods(false);
        }
      },
    });
  };

  const filteredMods = mods.filter(mod =>
    mod.name?.toLowerCase().includes(filter.toLowerCase()) ||
    mod.fileName?.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-gray-200">
            모드 ({filteredMods.length})
          </h2>
          {updates.length > 0 && (
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
              {updates.length}개 업데이트 가능
            </span>
          )}
        </div>
        {/* 모드 검색/설치/업데이트는 제작자 전용 (사용자 런처에선 설치된 목록만 조회) */}
        {isCreatorMode() && (
        <div className="flex gap-2">
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates || !profile}
            className="px-4 py-2 bg-hyeni-pink-600 text-white rounded-lg hover:bg-hyeni-pink-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${checkingUpdates ? 'animate-spin' : ''}`} />
            업데이트 확인
          </button>
          {updates.length > 0 && (
            <button
              onClick={handleUpdateAll}
              disabled={updatingMods}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updatingMods ? '업데이트 중...' : `${updates.length}개 업데이트`}
            </button>
          )}
          <button
            onClick={() => setShowSearchModal(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 font-medium"
          >
            <Plus className="w-4 h-4" />
            모드 검색
          </button>
          <label className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 cursor-pointer transition-colors">
            파일 업로드
            <input
              type="file"
              accept=".jar"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
        )}
      </div>

      {/* Search */}
      <div className="p-4">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="모드 검색..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-400"
        />
      </div>

      {/* Mod List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredMods.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {filter ? '검색 결과가 없습니다' : '설치된 모드가 없습니다'}
          </div>
        ) : (
          filteredMods.map((mod) => (
            <div
              key={mod.fileName}
              className={`p-4 border rounded-lg transition-colors ${
                mod.enabled
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-gray-900 border-gray-600 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-gray-200">
                      {mod.name}
                    </h3>
                    <span className="text-sm text-gray-400">
                      v{mod.version}
                    </span>
                    {mod.hasUpdate && mod.updateInfo && (
                      <span className="text-xs text-gray-500">
                        → v{mod.updateInfo.latestVersion}
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-xs rounded bg-blue-900 text-blue-200">
                      {mod.loader}
                    </span>
                    {mod.source && mod.source !== 'local' && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          mod.source === 'curseforge'
                            ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/50'
                            : 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/50'
                        }`}
                      >
                        {mod.source === 'curseforge' ? '🟠 CF' : '🟢 MR'}
                      </span>
                    )}
                    {mod.hasUpdate && (
                      <span className="px-2 py-1 bg-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium rounded border border-green-500/50 animate-pulse">
                        ✨ 업데이트 가능
                      </span>
                    )}
                  </div>
                  {mod.description && (
                    <p className="text-sm text-gray-400 mt-1">
                      {mod.description}
                    </p>
                  )}
                  {mod.authors && mod.authors.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      by {mod.authors.join(', ')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  {/* 업데이트 버튼 (업데이트 가능할 때만 표시) */}
                  {mod.hasUpdate && mod.updateInfo && (
                    <button
                      onClick={() => handleUpdateSingle(mod)}
                      disabled={updatingModIds.has(mod.fileName)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      {updatingModIds.has(mod.fileName) ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          업데이트 중...
                        </>
                      ) : (
                        <>⬆ 업데이트</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => toggleMod(mod.fileName, mod.enabled)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      mod.enabled
                        ? 'bg-green-900 text-green-300 hover:bg-green-800'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {mod.enabled ? '활성화됨' : '비활성화됨'}
                  </button>
                  <button
                    onClick={() => deleteMod(mod.fileName)}
                    className="px-3 py-1 bg-red-900 text-red-300 rounded text-sm font-medium hover:bg-red-800 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Mod Search Modal */}
      {profile && (
        <ModSearchModal
          isOpen={showSearchModal}
          profileId={profileId}
          profile={profile}
          gameVersion={profile.gameVersion}
          loaderType={profile.loaderType}
          onClose={() => setShowSearchModal(false)}
          onInstallSuccess={() => {
            loadMods();
            setShowSearchModal(false);
          }}
        />
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        variant="danger"
      />
    </div>
  );
};
