import React, { useState, useEffect } from 'react';
import { X, Search, Download, Loader2, ExternalLink, ChevronDown, AlertCircle, CheckCircle } from 'lucide-react';
import type { ModSearchResult, ModVersion } from '../../../shared/types/profile';

interface ModSearchModalProps {
  isOpen: boolean;
  profileId: string;
  gameVersion: string;
  loaderType: string;
  onClose: () => void;
  onInstallSuccess?: () => void;
}

export function ModSearchModal({
  isOpen,
  profileId,
  gameVersion,
  loaderType,
  onClose,
  onInstallSuccess,
}: ModSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMod, setSelectedMod] = useState<ModSearchResult | null>(null);
  const [modVersions, setModVersions] = useState<ModVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ModVersion | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [dependencyIssues, setDependencyIssues] = useState<any[]>([]);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
  const [showDependencies, setShowDependencies] = useState(false);
  const [searchSource, setSearchSource] = useState<'modrinth' | 'curseforge'>('modrinth');

  useEffect(() => {
    if (searchQuery.length > 2) {
      const debounce = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [searchQuery, searchSource]);

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;

    setIsSearching(true);
    setSearchResults([]);
    try {
      const result = await window.electronAPI.mod.search(searchQuery, {
        gameVersion,
        loaderType: loaderType === 'vanilla' ? undefined : loaderType,
        limit: 20,
        source: searchSource,
      });
      setSearchResults(result.hits);
    } catch (error) {
      console.error('Failed to search mods:', error);
      if (error instanceof Error && error.message.includes('CurseForge API key')) {
        alert('CurseForge API 키가 설정되지 않았습니다. Modrinth를 사용해주세요.');
        setSearchSource('modrinth');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectMod = async (mod: ModSearchResult) => {
    setSelectedMod(mod);
    setShowVersions(false);
    setIsLoadingVersions(true);
    setDependencies([]);
    setDependencyIssues([]);
    
    try {
      const versions = await window.electronAPI.mod.getVersions(
        mod.id,
        gameVersion,
        loaderType === 'vanilla' ? undefined : loaderType
      );
      setModVersions(versions);
      if (versions.length > 0) {
        await handleSelectVersion(versions[0]);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleSelectVersion = async (version: ModVersion) => {
    setSelectedVersion(version);
    setShowVersions(false);
    
    // Check dependencies for this version
    if (version.id) {
      setIsCheckingDependencies(true);
      try {
        const result = await window.electronAPI.mod.checkDependencies(
          profileId,
          version.id,
          gameVersion,
          loaderType
        );
        setDependencies(result.dependencies || []);
        setDependencyIssues(result.issues || []);
        
        if (result.dependencies.length > 0 || result.issues.length > 0) {
          setShowDependencies(true);
        }
      } catch (error) {
        console.error('Failed to check dependencies:', error);
      } finally {
        setIsCheckingDependencies(false);
      }
    }
  };

  const handleInstall = async () => {
    if (!selectedMod || !selectedVersion) return;

    setIsInstalling(true);
    try {
      // Install dependencies first if any
      const requiredDeps = dependencies.filter(dep => dep.required);
      if (requiredDeps.length > 0) {
        console.log(`Installing ${requiredDeps.length} required dependencies...`);
        const depResult = await window.electronAPI.mod.installDependencies(profileId, requiredDeps);
        
        if (depResult.failed.length > 0) {
          const failedNames = depResult.failed.map((f: any) => f.modId).join(', ');
          alert(`일부 의존성 설치 실패: ${failedNames}\n\n계속해서 모드를 설치합니다.`);
        }
      }

      // Install the main mod
      await window.electronAPI.mod.install(profileId, selectedMod.id, selectedVersion.id);
      
      const message = requiredDeps.length > 0
        ? `${selectedMod.name} 및 ${requiredDeps.length}개 의존성 설치 완료!`
        : `${selectedMod.name} 설치 완료!`;
      
      alert(message);
      onInstallSuccess?.();
      onClose();
    } catch (error) {
      console.error('Failed to install mod:', error);
      alert(`모드 설치 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsInstalling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-2xl font-bold">모드 검색 및 설치</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Search & Results */}
          <div className="w-1/2 border-r border-gray-800 flex flex-col">
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="모드 검색..."
                  className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  {gameVersion} • {loaderType}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSearchSource('modrinth')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      searchSource === 'modrinth'
                        ? 'bg-green-500/20 text-green-300 border border-green-500/50'
                        : 'bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    Modrinth
                  </button>
                  <button
                    onClick={() => setSearchSource('curseforge')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      searchSource === 'curseforge'
                        ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50'
                        : 'bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    CurseForge
                  </button>
                </div>
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isSearching ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  {searchQuery.length < 2
                    ? '검색어를 입력하세요'
                    : '검색 결과가 없습니다'}
                </div>
              ) : (
                searchResults.map((mod) => (
                  <div
                    key={mod.id}
                    onClick={() => handleSelectMod(mod)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      selectedMod?.id === mod.id
                        ? 'bg-purple-500/20 border-purple-500'
                        : 'bg-gray-800 border-gray-700 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex gap-3">
                      {mod.iconUrl && (
                        <img
                          src={mod.iconUrl}
                          alt={mod.name}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{mod.name}</h3>
                        <p className="text-sm text-gray-400 truncate">
                          by {mod.author}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span>⬇ {mod.downloads.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Mod Details & Install */}
          <div className="w-1/2 flex flex-col">
            {selectedMod ? (
              <>
                {/* Mod Info */}
                <div className="p-6 border-b border-gray-800">
                  <div className="flex gap-4">
                    {selectedMod.iconUrl && (
                      <img
                        src={selectedMod.iconUrl}
                        alt={selectedMod.name}
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold mb-1">
                        {selectedMod.name}
                      </h3>
                      <p className="text-gray-400 mb-2">by {selectedMod.author}</p>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>⬇ {selectedMod.downloads.toLocaleString()}</span>
                        <span>❤ {selectedMod.followers.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-gray-300 line-clamp-3">
                    {selectedMod.description}
                  </p>
                </div>

                {/* Version Selection */}
                <div className="p-6 border-b border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-gray-300">
                      버전 선택
                    </label>
                    <button
                      onClick={() => setShowVersions(!showVersions)}
                      className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      {modVersions.length}개 버전
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                          showVersions ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {isLoadingVersions ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                    </div>
                  ) : (
                    <>
                      {selectedVersion && !showVersions && (
                        <div className="p-3 bg-gray-800 rounded-lg border border-gray-700">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">
                                {selectedVersion.name}
                              </div>
                              <div className="text-sm text-gray-400">
                                {selectedVersion.versionNumber}
                              </div>
                            </div>
                            <div className="text-xs text-gray-500">
                              {(selectedVersion.fileSize / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                        </div>
                      )}

                      {showVersions && (
                        <div className="max-h-64 overflow-y-auto space-y-2">
                          {modVersions.map((version) => (
                            <div
                              key={version.id}
                              onClick={() => handleSelectVersion(version)}
                              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                selectedVersion?.id === version.id
                                  ? 'bg-purple-500/20 border-purple-500'
                                  : 'bg-gray-800 border-gray-700 hover:border-purple-500/50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">{version.name}</div>
                                  <div className="text-sm text-gray-400">
                                    {version.versionNumber}
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {(version.fileSize / 1024 / 1024).toFixed(2)} MB
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Dependencies Section */}
                {(dependencies.length > 0 || dependencyIssues.length > 0) && (
                  <div className="px-6 pb-4 border-b border-gray-800">
                    <div className="flex items-center gap-2 mb-3">
                      {isCheckingDependencies ? (
                        <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                      ) : dependencies.length > 0 ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      )}
                      <span className="text-sm font-semibold text-gray-300">
                        의존성 {dependencies.length}개
                      </span>
                    </div>

                    {dependencies.length > 0 && (
                      <div className="space-y-2">
                        {dependencies.map((dep: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 bg-gray-800/50 rounded border border-gray-700 text-sm"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-200">
                                  {dep.modName}
                                </span>
                                <span className="text-xs text-gray-500">
                                  v{dep.versionNumber}
                                </span>
                              </div>
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  dep.required
                                    ? 'bg-red-500/20 text-red-300'
                                    : 'bg-blue-500/20 text-blue-300'
                                }`}
                              >
                                {dep.required ? '필수' : '선택'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {dependencyIssues.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {dependencyIssues.map((issue: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm"
                          >
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />
                              <div>
                                <div className="font-medium text-yellow-300">
                                  {issue.modName}
                                </div>
                                <div className="text-xs text-yellow-200/80">
                                  {issue.message}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Install Button */}
                <div className="p-6">
                  <button
                    onClick={handleInstall}
                    disabled={!selectedVersion || isInstalling}
                    className="w-full btn-primary py-4 text-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isInstalling ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        설치 중...
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5" />
                        {dependencies.filter(d => d.required).length > 0
                          ? `모드 + 의존성 ${dependencies.filter(d => d.required).length}개 설치`
                          : '모드 설치'}
                      </>
                    )}
                  </button>
                  {dependencies.filter(d => d.required).length > 0 && (
                    <p className="text-xs text-gray-400 text-center mt-2">
                      필수 의존성이 자동으로 함께 설치됩니다
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                모드를 선택하세요
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
