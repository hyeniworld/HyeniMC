import React, { useState, useEffect } from 'react';

interface ShaderPack {
  name: string;
  fileName: string;
  enabled: boolean;
  isDirectory: boolean;
}

interface ShaderPackListProps {
  profileId: string;
}

export const ShaderPackList: React.FC<ShaderPackListProps> = ({ profileId }) => {
  const [packs, setPacks] = useState<ShaderPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadPacks();
  }, [profileId]);

  const loadPacks = async () => {
    setLoading(true);
    try {
      const packList = await window.electronAPI.shaderpack.list(profileId);
      setPacks(packList);
    } catch (error) {
      console.error('Failed to load shader packs:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePack = async (fileName: string, enabled: boolean, isDirectory: boolean) => {
    if (isDirectory) {
      alert('디렉토리 형태의 셸이더팩은 활성화/비활성화할 수 없습니다.');
      return;
    }

    try {
      if (enabled) {
        await window.electronAPI.shaderpack.disable(profileId, fileName, isDirectory);
      } else {
        await window.electronAPI.shaderpack.enable(profileId, fileName, isDirectory);
      }
      // Update state locally instead of reloading
      setPacks(prev => prev.map(pack => 
        pack.fileName === fileName ? { ...pack, enabled: !enabled } : pack
      ));
    } catch (error) {
      console.error('Failed to toggle shader pack:', error);
      await loadPacks(); // Reload on error
    }
  };

  const deletePack = async (fileName: string, isDirectory: boolean) => {
    if (!confirm('정말 이 셸이더팩을 삭제하시겠습니까?')) return;

    try {
      await window.electronAPI.shaderpack.delete(profileId, fileName, isDirectory);
      // Update state locally instead of reloading
      setPacks(prev => prev.filter(pack => pack.fileName !== fileName));
    } catch (error) {
      console.error('Failed to delete shader pack:', error);
      await loadPacks(); // Reload on error
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('pack', file);

    try {
      await fetch(`/api/profiles/${profileId}/shaderpacks`, {
        method: 'POST',
        body: formData,
      });
      await loadPacks();
    } catch (error) {
      console.error('Failed to install shader pack:', error);
    }
  };

  const filteredPacks = packs.filter(pack =>
    pack.name?.toLowerCase().includes(filter.toLowerCase()) ||
    pack.fileName?.toLowerCase().includes(filter.toLowerCase())
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
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
            셰이더팩 ({filteredPacks.length})
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Iris 또는 OptiFine이 필요합니다
          </p>
        </div>
        <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
          셰이더팩 추가
          <input
            type="file"
            accept=".zip"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Search */}
      <div className="p-4">
        <input
          type="text"
          placeholder="셰이더팩 검색..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
        />
      </div>

      {/* Pack List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredPacks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {filter ? '검색 결과가 없습니다' : '설치된 셰이더팩이 없습니다'}
          </div>
        ) : (
          filteredPacks.map((pack) => (
            <div
              key={pack.fileName}
              className={`p-4 border rounded-lg transition-colors ${
                pack.enabled
                  ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  : 'bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 opacity-60'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                      {pack.name}
                    </h3>
                    {pack.isDirectory && (
                      <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200">
                        폴더
                      </span>
                    )}
                    {!pack.isDirectory && (
                      <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                        ZIP
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {pack.fileName}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {!pack.isDirectory && (
                    <button
                      onClick={() => togglePack(pack.fileName, pack.enabled, pack.isDirectory)}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        pack.enabled
                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      {pack.enabled ? '활성화됨' : '비활성화됨'}
                    </button>
                  )}
                  <button
                    onClick={() => deletePack(pack.fileName, pack.isDirectory)}
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
