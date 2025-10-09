import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { ModSearchModal } from './ModSearchModal';

interface Mod {
  id: string;
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  enabled: boolean;
  loader: string;
  fileName: string;
}

interface ModListProps {
  profileId: string;
}

export const ModList: React.FC<ModListProps> = ({ profileId }) => {
  const [mods, setMods] = useState<Mod[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [updates, setUpdates] = useState<any[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState(false);

  useEffect(() => {
    loadProfile();
    loadMods();
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

  const toggleMod = async (fileName: string, enabled: boolean) => {
    try {
      await window.electronAPI.mod.toggle(profileId, fileName, !enabled);
      // Update state locally instead of reloading
      setMods(prev => prev.map(mod => 
        mod.fileName === fileName ? { ...mod, enabled: !enabled } : mod
      ));
    } catch (error) {
      console.error('Failed to toggle mod:', error);
      await loadMods(); // Reload on error
    }
  };

  const deleteMod = async (fileName: string) => {
    if (!confirm('정말 이 모드를 삭제하시겠습니까?')) return;

    try {
      await window.electronAPI.mod.remove(profileId, fileName);
      setMods(prev => prev.filter(mod => mod.fileName !== fileName));
    } catch (error) {
      console.error('Failed to delete mod:', error);
      await loadMods();
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    console.log('File selected:', file.name);
    alert('모드 파일 업로드 기능은 준비 중입니다.');
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
      
      if (foundUpdates.length === 0) {
        alert('모든 모드가 최신 버전입니다!');
      } else {
        alert(`${foundUpdates.length}개의 업데이트를 찾았습니다!`);
      }
    } catch (error) {
      console.error('Failed to check updates:', error);
      alert('업데이트 확인에 실패했습니다.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdateAll = async () => {
    if (updates.length === 0) return;

    if (!confirm(`${updates.length}개의 모드를 업데이트하시겠습니까?`)) {
      return;
    }

    setUpdatingMods(true);
    try {
      const result = await window.electronAPI.mod.updateAll(profileId, updates);
      
      const message = `성공: ${result.success.length}개\n실패: ${result.failed.length}개`;
      alert(`모드 업데이트 완료!\n\n${message}`);
      
      setUpdates([]);
      await loadMods();
    } catch (error) {
      console.error('Failed to update mods:', error);
      alert('모드 업데이트에 실패했습니다.');
    } finally {
      setUpdatingMods(false);
    }
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
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
            모드 ({filteredMods.length})
          </h2>
          {updates.length > 0 && (
            <span className="px-3 py-1 bg-green-500/20 text-green-600 dark:text-green-400 rounded-full text-sm font-medium">
              {updates.length}개 업데이트 가능
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates || !profile}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
      </div>

      {/* Search */}
      <div className="p-4">
        <input
          type="text"
          placeholder="모드 검색..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
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
                  ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                      {mod.name}
                    </h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      v{mod.version}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                      {mod.loader}
                    </span>
                  </div>
                  {mod.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {mod.description}
                    </p>
                  )}
                  {mod.authors && mod.authors.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      by {mod.authors.join(', ')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => toggleMod(mod.fileName, mod.enabled)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      mod.enabled
                        ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {mod.enabled ? '활성화됨' : '비활성화됨'}
                  </button>
                  <button
                    onClick={() => deleteMod(mod.fileName)}
                    className="px-3 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded text-sm font-medium hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
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
          gameVersion={profile.gameVersion}
          loaderType={profile.loaderType}
          onClose={() => setShowSearchModal(false)}
          onInstallSuccess={() => {
            loadMods();
            setShowSearchModal(false);
          }}
        />
      )}
    </div>
  );
};
