import React, { useState, useEffect } from 'react';

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

  useEffect(() => {
    loadMods();
  }, [profileId]);

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
      // Update state locally instead of reloading
      setMods(prev => prev.filter(mod => mod.fileName !== fileName));
    } catch (error) {
      console.error('Failed to delete mod:', error);
      await loadMods(); // Reload on error
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('mod', file);

    try {
      await fetch(`/api/profiles/${profileId}/mods`, {
        method: 'POST',
        body: formData,
      });
      await loadMods();
    } catch (error) {
      console.error('Failed to install mod:', error);
    }
  };

  const filteredMods = mods.filter(mod =>
    mod.name?.toLowerCase().includes(filter.toLowerCase()) ||
    mod.id?.toLowerCase().includes(filter.toLowerCase()) ||
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
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
          모드 ({filteredMods.length})
        </h2>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
          모드 추가
          <input
            type="file"
            accept=".jar"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
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
    </div>
  );
};
