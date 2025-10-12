import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { X, Search, Download, Loader2, Package, Calendar, Users } from 'lucide-react';

interface ModpackSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  followers: number;
  categories: string[];
  gameVersions: string[];
  source: 'modrinth' | 'curseforge';
  updatedAt: Date;
}

interface ModpackVersion {
  id: string;
  name: string;
  versionNumber: string;
  gameVersion: string;
  loaders: string[];
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  publishedAt: Date;
}

interface ModpackSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modpackId: string, versionId: string, gameVersion: string, loaderType: string) => void;
}

export function ModpackSearchModal({
  isOpen,
  onClose,
  onSelect,
}: ModpackSearchModalProps) {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModpackSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedModpack, setSelectedModpack] = useState<ModpackSearchResult | null>(null);
  const [modpackVersions, setModpackVersions] = useState<ModpackVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ModpackVersion | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  useEffect(() => {
    if (searchQuery.length > 2) {
      const debounce = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [searchQuery]);

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;

    setIsSearching(true);
    setSearchResults([]);
    try {
      const results = await window.electronAPI.modpack.search(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error('Failed to search modpacks:', error);
      toast.error('검색 실패', '모드팩 검색에 실패했습니다.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectModpack = async (modpack: ModpackSearchResult) => {
    setSelectedModpack(modpack);
    setIsLoadingVersions(true);
    setModpackVersions([]);
    setSelectedVersion(null);

    try {
      const versions = await window.electronAPI.modpack.getVersions(modpack.id);
      setModpackVersions(versions);
      if (versions.length > 0) {
        setSelectedVersion(versions[0]);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
      toast.error('불러오기 실패', '버전 정보를 불러오는데 실패했습니다.');
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedModpack || !selectedVersion) return;

    const loaderType = selectedVersion.loaders[0] || 'vanilla';
    onSelect(
      selectedModpack.id,
      selectedVersion.id,
      selectedVersion.gameVersion,
      loaderType
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-purple-500" />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
              모드팩 검색
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Search Results */}
          <div className="w-1/2 border-r border-gray-200 dark:border-gray-800 flex flex-col">
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="모드팩 검색... (예: 혜니월드, Fabulously Optimized)"
                  className="w-full pl-10 pr-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isSearching ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <Package className="w-16 h-16 mb-4 opacity-20" />
                  <p>모드팩을 검색하세요</p>
                </div>
              ) : (
                searchResults.map((modpack) => (
                  <div
                    key={modpack.id}
                    onClick={() => handleSelectModpack(modpack)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      selectedModpack?.id === modpack.id
                        ? 'bg-purple-500/10 border-purple-500'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex gap-3">
                      {modpack.iconUrl ? (
                        <img
                          src={modpack.iconUrl}
                          alt={modpack.name}
                          className="w-16 h-16 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <Package className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                          {modpack.name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          by {modpack.author}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">
                          {modpack.description}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Download className="w-3 h-3" />
                            {modpack.downloads.toLocaleString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {modpack.followers.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Version Selection */}
          <div className="w-1/2 flex flex-col">
            {selectedModpack ? (
              <>
                {/* Modpack Info */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-800">
                  <div className="flex gap-4">
                    {selectedModpack.iconUrl && (
                      <img
                        src={selectedModpack.iconUrl}
                        alt={selectedModpack.name}
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">
                        {selectedModpack.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        by {selectedModpack.author}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selectedModpack.categories.slice(0, 3).map((cat) => (
                          <span
                            key={cat}
                            className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Version Selection */}
                <div className="flex-1 overflow-y-auto p-6">
                  <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    버전 선택
                  </h4>
                  {isLoadingVersions ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                    </div>
                  ) : modpackVersions.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      사용 가능한 버전이 없습니다
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {modpackVersions.map((version) => (
                        <div
                          key={version.id}
                          onClick={() => setSelectedVersion(version)}
                          className={`p-4 rounded-lg border cursor-pointer transition-all ${
                            selectedVersion?.id === version.id
                              ? 'bg-purple-500/10 border-purple-500'
                              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-purple-500/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-gray-800 dark:text-gray-200">
                                {version.name}
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                                <span>Minecraft {version.gameVersion}</span>
                                <span>•</span>
                                <span>{version.loaders.join(', ') || 'Vanilla'}</span>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500">
                              {(version.fileSize / 1024 / 1024).toFixed(1)} MB
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Button */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-800">
                  <button
                    onClick={handleConfirm}
                    disabled={!selectedVersion}
                    className="w-full btn-primary py-3 text-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-5 h-5" />
                    모드팩 설치
                  </button>
                  {selectedVersion && (
                    <p className="text-xs text-gray-500 text-center mt-2">
                      Minecraft {selectedVersion.gameVersion} • {selectedVersion.loaders[0] || 'Vanilla'}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Package className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p>모드팩을 선택하세요</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
