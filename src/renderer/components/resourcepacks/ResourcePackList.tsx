import React, { useState, useEffect, useRef } from 'react';

interface ResourcePack {
  name: string;
  description?: string;
  packFormat: number;
  fileName: string;
  enabled: boolean;
  icon?: string;
}

interface ResourcePackListProps {
  profileId: string;
}

export const ResourcePackList: React.FC<ResourcePackListProps> = ({ profileId }) => {
  const [packs, setPacks] = useState<ResourcePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 포커스 복원 헬퍼 함수
  const restoreFocus = () => {
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

  const renderDescription = (desc: any): string => {
    if (!desc) return '';
    if (typeof desc === 'string') return desc;
    if (Array.isArray(desc)) return desc.filter((v) => typeof v === 'string').join(' ');
    // object form like { translate, fallback }
    return desc.fallback || desc.translate || JSON.stringify(desc);
  };

  useEffect(() => {
    loadPacks();
    
    // Start file watcher
    const startWatcher = async () => {
      try {
        const profile = await window.electronAPI.profile.get(profileId);
        await window.electronAPI.fileWatcher.start(profileId, profile.gameDirectory);
      } catch (error) {
        console.error('[ResourcePackList] Failed to start file watcher:', error);
      }
    };
    startWatcher();
    
    // Listen for file changes
    const cleanup = window.electronAPI.on('file:changed', async (data: any) => {
      if (data.profileId === profileId && data.type === 'resourcepacks') {
        console.log('[ResourcePackList] File changed:', data);
        
        // Partial update instead of full reload to prevent flicker
        if (data.action === 'remove') {
          // Remove pack from list immediately
          setPacks(prev => prev.filter(pack => pack.fileName !== data.fileName));
        } else if (data.action === 'add' || data.action === 'change') {
          // Reload to get the new/updated pack info
          const packList = await window.electronAPI.resourcepack.list(profileId);
          setPacks(packList);
        }
      }
    });
    
    return () => {
      cleanup();
      window.electronAPI.fileWatcher.stop(profileId).catch(console.error);
    };
  }, [profileId]);

  const loadPacks = async () => {
    setLoading(true);
    try {
      const packList = await window.electronAPI.resourcepack.list(profileId);
      setPacks(packList);
    } catch (error) {
      console.error('Failed to load resource packs:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePack = async (fileName: string, enabled: boolean) => {
    try {
      if (enabled) {
        await window.electronAPI.resourcepack.disable(profileId, fileName);
      } else {
        await window.electronAPI.resourcepack.enable(profileId, fileName);
      }
      // Update state locally instead of reloading
      setPacks(prev => prev.map(pack => 
        pack.fileName === fileName ? { ...pack, enabled: !enabled } : pack
      ));
      restoreFocus();
    } catch (error) {
      console.error('Failed to toggle resource pack:', error);
      await loadPacks(); // Reload on error
      restoreFocus();
    }
  };

  const deletePack = async (fileName: string) => {
    if (!confirm('정말 이 리소스팩을 삭제하시겠습니까?')) {
      restoreFocus();
      return;
    }

    try {
      await window.electronAPI.resourcepack.delete(profileId, fileName);
      // Update state locally instead of reloading
      setPacks(prev => prev.filter(pack => pack.fileName !== fileName));
      restoreFocus();
    } catch (error) {
      console.error('Failed to delete resource pack:', error);
      await loadPacks(); // Reload on error
      restoreFocus();
    }
  };

  const handleFileUpload = async () => {
    try {
      const filePath = await window.electronAPI.resourcepack.selectFile();
      if (!filePath) return;
      await window.electronAPI.resourcepack.install(profileId, filePath);
      await loadPacks();
    } catch (error) {
      console.error('Failed to install resource pack:', error);
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
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-xl font-semibold text-gray-200">
          리소스팩 ({filteredPacks.length})
        </h2>
        <button onClick={handleFileUpload} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          리소스팩 추가
        </button>
      </div>

      {/* Search */}
      <div className="p-4">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="리소스팩 검색..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 border border-gray-600 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-400"
        />
      </div>

      {/* Pack List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredPacks.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {filter ? '검색 결과가 없습니다' : '설치된 리소스팩이 없습니다'}
          </div>
        ) : (
          filteredPacks.map((pack) => (
            <div
              key={pack.fileName}
              className={`p-4 border rounded-lg transition-colors ${
                pack.enabled
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-gray-900 border-gray-600 opacity-60'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                {pack.icon && (
                  <img
                    src={pack.icon}
                    alt={pack.name}
                    className="w-16 h-16 rounded border border-gray-600"
                  />
                )}

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-200">
                      {pack.name}
                    </h3>
                    <span className="px-2 py-0.5 text-xs rounded bg-purple-900 text-purple-200">
                      Format {pack.packFormat}
                    </span>
                  </div>
                  {pack.description && (
                    <p className="text-sm text-gray-400 mt-1">
                      {renderDescription(pack.description as any)}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => togglePack(pack.fileName, pack.enabled)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      pack.enabled
                        ? 'bg-green-900 text-green-300 hover:bg-green-800'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {pack.enabled ? '활성화됨' : '비활성화됨'}
                  </button>
                  <button
                    onClick={() => deletePack(pack.fileName)}
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
    </div>
  );
};
