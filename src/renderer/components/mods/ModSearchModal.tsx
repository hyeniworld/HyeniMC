import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { X, Search, Download, Loader2, ExternalLink, ChevronDown, AlertCircle, CheckCircle, Check, ArrowUp, ArrowDown, RefreshCw, ArrowRight, AlertTriangle, Trash2 } from 'lucide-react';
import type { ModSearchResult, ModVersion, Mod, ModSearchSortOption } from '../../../shared/types/profile';
import { compareVersions, parseVersion } from '../../utils/version';

type InstallButtonState = 
  | 'install'        // 설치되지 않음
  | 'installed'      // 동일 버전 설치됨
  | 'update'         // 더 최신 버전 존재
  | 'downgrade'      // 더 낮은 버전 선택
  | 'reinstall';     // 다른 파일명이지만 같은 버전

interface ButtonStateInfo {
  state: InstallButtonState;
  installedVersion?: string;
  selectedVersionNumber: string;
}

interface ModSearchModalProps {
  isOpen: boolean;
  profileId: string;
  profile: any;
  gameVersion: string;
  loaderType: string;
  onClose: () => void;
  onInstallSuccess?: () => void;
}

export function ModSearchModal({ isOpen, onClose, profileId, profile, gameVersion, loaderType, onInstallSuccess }: ModSearchModalProps) {
  const toast = useToast();
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
  const [sortBy, setSortBy] = useState<ModSearchSortOption>('relevance');
  const [installedMods, setInstalledMods] = useState<Mod[]>([]);
  const [installedModMap, setInstalledModMap] = useState<Map<string, Mod>>(new Map());

  // Load installed mods when modal opens
  useEffect(() => {
    if (isOpen) {
      loadInstalledMods();
    }
  }, [isOpen, profileId]);

  // Re-check installed mods when installedMods changes (after deletion/disable)
  useEffect(() => {
    if (searchResults.length > 0) {
      checkInstalledMods(searchResults);
      console.log('[ModSearchModal] Re-checked installed mods for existing search results');
    }
  }, [installedMods]);

  useEffect(() => {
    if (searchQuery.length > 2) {
      const debounce = setTimeout(() => {
        handleSearch();
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [searchQuery, searchSource, sortBy]);

  const loadInstalledMods = async () => {
    try {
      // Force refresh to get latest mod list (bypass cache)
      const mods = await window.electronAPI.mod.list(profileId, true);
      setInstalledMods(mods);
      console.log('[ModSearchModal] Loaded installed mods:', mods);
    } catch (error) {
      console.error('[ModSearchModal] Failed to load installed mods:', error);
    }
  };

  const checkInstalledMods = (searchResults: ModSearchResult[]) => {
    const map = new Map<string, Mod>();

    for (const result of searchResults) {
      // 1) sourceModId로 직접 매칭 (런처에서 설치한 모드)
      const directMatch = installedMods.find(mod => {
        if (mod.modId === result.id) {
          return mod.source === result.source || mod.source === 'local' || !mod.source;
        }
        return false;
      });
      
      if (directMatch) {
        map.set(result.id, directMatch);
        continue;
      }

      // 2) 파일명 기반 휴리스틱 매칭 (수동 설치한 모드, API 호출 없음)
      // 예: "iris-neoforge-1.8.12.jar" → slug "iris"와 매칭
      const slug = result.slug?.toLowerCase();
      if (slug) {
        const filenameMatch = installedMods.find(mod => {
          const fileName = mod.fileName.toLowerCase();
          // 파일명이 slug로 시작하는지 확인 (정확도 높음)
          return fileName.startsWith(slug + '-') || 
                 fileName.startsWith(slug + '_') ||
                 fileName === slug + '.jar';
        });
        
        if (filenameMatch) {
          map.set(result.id, filenameMatch);
        }
      }
    }

    setInstalledModMap(map);
  };

  const isVersionInstalled = (fileName: string): boolean => {
    return installedMods.some(mod => mod.fileName === fileName);
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;

    setIsSearching(true);
    setSearchResults([]);
    // 검색 시작 시 이전 선택 초기화
    setSelectedMod(null);
    setSelectedVersion(null);
    setModVersions([]);
    setDependencies([]);
    setDependencyIssues([]);
    
    try {
      const result = await window.electronAPI.mod.search(searchQuery, {
        gameVersion,
        loaderType: loaderType === 'vanilla' ? undefined : loaderType,
        limit: 20,
        source: searchSource,
        sortBy: sortBy,
      });
      setSearchResults(result.hits);
      
      // Check which mods are already installed
      checkInstalledMods(result.hits);
    } catch (error) {
      console.error('Failed to search mods:', error);
      if (error instanceof Error && error.message.includes('CurseForge API key')) {
        toast.warning('API 키 없음', 'CurseForge API 키가 설정되지 않았습니다. Modrinth를 사용해주세요.');
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
      const source = mod.source === 'modrinth' || mod.source === 'curseforge' ? mod.source : 'modrinth';
      const versions = await window.electronAPI.mod.getVersions(
        mod.id,
        gameVersion,
        loaderType === 'vanilla' ? undefined : loaderType,
        source  // Pass source (modrinth | curseforge)
      );
      setModVersions(versions);
      if (versions.length > 0) {
        // Pass mod directly to avoid state update timing issues
        await handleSelectVersion(versions[0], mod);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleSelectVersion = async (version: ModVersion, mod?: ModSearchResult) => {
    // Use passed mod or selectedMod from state
    const currentMod = mod || selectedMod;
    
    console.log('[ModSearchModal] Selecting version:', version.id, 'for mod:', currentMod?.id, 'source:', currentMod?.source);
    setSelectedVersion(version);
    setShowVersions(false);
    
    // Check dependencies for this version
    if (version.id && currentMod) {
      console.log('[ModSearchModal] Checking dependencies for:', {
        modId: currentMod.id,
        versionId: version.id,
        gameVersion,
        loaderType,
        source: currentMod.source
      });
      setIsCheckingDependencies(true);
      try {
        const source = currentMod.source === 'modrinth' || currentMod.source === 'curseforge' ? currentMod.source : 'modrinth';
        const result = await window.electronAPI.mod.checkDependencies(
          profileId,
          currentMod.id,      // Pass modId
          version.id,
          gameVersion,
          loaderType,
          source  // Pass source
        );
        console.log('[ModSearchModal] Dependency check result:', result);
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
    } else {
      console.log('[ModSearchModal] Skipping dependency check - no version.id or currentMod');
    }
  };

  // 설치 버튼 상태 계산
  const buttonState = useMemo((): ButtonStateInfo => {
    if (!selectedMod || !selectedVersion) {
      return { state: 'install', selectedVersionNumber: '' };
    }

    const installedMod = installedModMap.get(selectedMod.id);
    
    if (!installedMod) {
      return { 
        state: 'install', 
        selectedVersionNumber: selectedVersion.versionNumber 
      };
    }

    // 버전 비교
    const installed = parseVersion(installedMod.version);
    const selected = parseVersion(selectedVersion.versionNumber);
    const comparison = compareVersions(installed, selected);

    if (comparison === 0) {
      // 파일명 확인
      if (installedMod.fileName === selectedVersion.fileName) {
        return { 
          state: 'installed', 
          installedVersion: installed, 
          selectedVersionNumber: selected 
        };
      } else {
        return { 
          state: 'reinstall', 
          installedVersion: installed, 
          selectedVersionNumber: selected 
        };
      }
    } else if (comparison < 0) {
      return { 
        state: 'update', 
        installedVersion: installed, 
        selectedVersionNumber: selected 
      };
    } else {
      return { 
        state: 'downgrade', 
        installedVersion: installed, 
        selectedVersionNumber: selected 
      };
    }
  }, [selectedMod, selectedVersion, installedModMap]);

  const handleInstall = async () => {
    if (!selectedMod || !selectedVersion) return;

    // 다운그레이드 경고
    if (buttonState.state === 'downgrade') {
      const confirmed = window.confirm(
        `⚠️ 다운그레이드 경고\n\n` +
        `현재 버전: v${buttonState.installedVersion}\n` +
        `선택한 버전: v${buttonState.selectedVersionNumber}\n\n` +
        `이전 버전으로 다운그레이드하면 호환성 문제가 발생할 수 있습니다.\n계속하시겠습니까?`
      );
      if (!confirmed) return;
    }

    setIsInstalling(true);
    try {
      // 기존 파일 삭제 (업데이트/다운그레이드/재설치/설치됨)
      if (['update', 'downgrade', 'reinstall', 'installed'].includes(buttonState.state)) {
        const installedMod = installedModMap.get(selectedMod.id);
        if (installedMod) {
          console.log(`[ModSearchModal] Removing old version: ${installedMod.fileName}`);
          await window.electronAPI.mod.remove(profileId, installedMod.fileName);
        }
      }

      // Install dependencies first if any
      const requiredDeps = dependencies.filter(dep => dep.required);
      if (requiredDeps.length > 0) {
        console.log(`Installing ${requiredDeps.length} required dependencies...`);
        const depResult = await window.electronAPI.mod.installDependencies(profileId, requiredDeps);
        
        if (depResult.failed.length > 0) {
          const failedNames = depResult.failed.map((f: any) => f.modId).join(', ');
          toast.warning('의존성 설치 실패', `일부 의존성 설치 실패: ${failedNames}`);
        }
      }

      // Install the main mod
      const source = selectedMod.source === 'modrinth' || selectedMod.source === 'curseforge' ? selectedMod.source : 'modrinth';
      await window.electronAPI.mod.install(profileId, selectedMod.id, selectedVersion.id, source);
      
      let actionText = '설치';
      if (buttonState.state === 'update') actionText = '업데이트';
      else if (buttonState.state === 'downgrade') actionText = '다운그레이드';
      else if (buttonState.state === 'reinstall' || buttonState.state === 'installed') actionText = '재설치';
      
      const message = requiredDeps.length > 0
        ? `${selectedMod.name} ${actionText} 및 ${requiredDeps.length}개 의존성 설치 완료!`
        : `${selectedMod.name} ${actionText} 완료!`;
      
      toast.success(`${actionText} 성공`, message);
      
      // Reload installed mods to update UI
      await loadInstalledMods();
      
      onInstallSuccess?.();
      onClose();
    } catch (error) {
      console.error('Failed to install mod:', error);
      toast.error('설치 실패', `모드 설치 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
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
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-sm text-gray-400 flex-shrink-0">
                  {gameVersion} • {loaderType}
                </div>
                <div className="flex items-center gap-2">
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
                  <div className="h-4 w-px bg-gray-700"></div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as ModSearchSortOption)}
                    className="px-3 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 min-w-[120px]"
                  >
                    <option value="relevance">관련성</option>
                    <option value="downloads">다운로드 수</option>
                    <option value="updated">업데이트순</option>
                    <option value="newest">최신순</option>
                  </select>
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
                searchResults.map((mod) => {
                  const installedMod = installedModMap.get(mod.id);
                  return (
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold truncate">{mod.name}</h3>
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                              mod.source === 'curseforge'
                                ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50'
                                : 'bg-green-500/20 text-green-300 border border-green-500/50'
                            }`}
                          >
                            {mod.source === 'curseforge' ? '🟠 CF' : '🟢 MR'}
                          </span>
                          {installedMod && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-500/20 text-blue-300 border border-blue-500/50 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              설치됨
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 truncate">
                          by {mod.author}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span>⬇ {mod.downloads.toLocaleString()}</span>
                          {installedMod && (
                            <span className="text-blue-400">• v{installedMod.version}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Mod Details & Install */}
          <div className="w-1/2 flex flex-col">
            {selectedMod ? (
              <>
                {/* Mod Info (고정) */}
                <div className="p-6 border-b border-gray-800 flex-shrink-0">
                  <div className="flex gap-4">
                    {selectedMod.iconUrl && (
                      <img
                        src={selectedMod.iconUrl}
                        alt={selectedMod.name}
                        className="w-20 h-20 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-2xl font-bold">
                          {selectedMod.name}
                        </h3>
                        <span
                          className={`px-3 py-1 text-sm font-medium rounded ${
                            selectedMod.source === 'curseforge'
                              ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50'
                              : 'bg-green-500/20 text-green-300 border border-green-500/50'
                          }`}
                        >
                          {selectedMod.source === 'curseforge' ? '🟠 CurseForge' : '🟢 Modrinth'}
                        </span>
                      </div>
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

                {/* Scrollable Content: Version Selection & Dependencies */}
                <div className="flex-1 overflow-y-auto">
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
                </div>

                {/* Install Button (하단 고정) */}
                <div className="p-6 border-t border-gray-800 flex-shrink-0">
                  {buttonState.state === 'installed' ? (
                    /* 설치됨 상태: 재설치 + 삭제 버튼 */
                    <div className="flex gap-3">
                      <button
                        onClick={handleInstall}
                        disabled={!selectedVersion || isInstalling}
                        className="flex-1 py-4 text-lg font-semibold flex items-center justify-center gap-2 rounded-lg transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            재설치 중...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-5 h-5" />
                            재설치
                          </>
                        )}
                      </button>
                      <button
                        onClick={async () => {
                          if (!selectedMod || isInstalling) return;
                          const installedMod = installedModMap.get(selectedMod.id);
                          if (!installedMod) return;
                          
                          const confirmed = window.confirm(
                            `${selectedMod.name}을(를) 삭제하시겠습니까?\n\n` +
                            `파일: ${installedMod.fileName}`
                          );
                          if (!confirmed) return;
                          
                          try {
                            await window.electronAPI.mod.remove(profileId, installedMod.fileName);
                            toast.success('삭제 완료', `${selectedMod.name}이(가) 삭제되었습니다.`);
                            await loadInstalledMods();
                          } catch (error) {
                            console.error('Failed to delete mod:', error);
                            toast.error('삭제 실패', `모드 삭제에 실패했습니다.`);
                          }
                        }}
                        disabled={isInstalling}
                        className="px-6 py-4 text-lg font-semibold flex items-center justify-center gap-2 rounded-lg transition-colors bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-5 h-5" />
                        삭제
                      </button>
                    </div>
                  ) : (
                    /* 일반 상태: 설치/업데이트/다운그레이드/재설치 버튼 */
                    <button
                      onClick={handleInstall}
                      disabled={!selectedVersion || isInstalling}
                      className={`w-full py-4 text-lg font-semibold flex items-center justify-center gap-2 rounded-lg transition-colors ${
                        buttonState.state === 'update'
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : buttonState.state === 'downgrade'
                          ? 'bg-orange-600 hover:bg-orange-700 text-white'
                          : buttonState.state === 'reinstall'
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'btn-primary'
                      } ${(!selectedVersion || isInstalling) && 'opacity-50 cursor-not-allowed'}`}
                    >
                    {isInstalling ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {buttonState.state === 'update' ? '업데이트 중...' :
                         buttonState.state === 'downgrade' ? '다운그레이드 중...' :
                         buttonState.state === 'reinstall' ? '재설치 중...' : '설치 중...'}
                      </>
                    ) : buttonState.state === 'update' ? (
                      <>
                        <ArrowUp className="w-5 h-5" />
                        {dependencies.filter(d => d.required).length > 0
                          ? `업데이트 + 의존성 ${dependencies.filter(d => d.required).length}개`
                          : '업데이트'}
                      </>
                    ) : buttonState.state === 'downgrade' ? (
                      <>
                        <ArrowDown className="w-5 h-5" />
                        {dependencies.filter(d => d.required).length > 0
                          ? `다운그레이드 + 의존성 ${dependencies.filter(d => d.required).length}개`
                          : '다운그레이드'}
                      </>
                    ) : buttonState.state === 'reinstall' ? (
                      <>
                        <RefreshCw className="w-5 h-5" />
                        {dependencies.filter(d => d.required).length > 0
                          ? `재설치 + 의존성 ${dependencies.filter(d => d.required).length}개`
                          : '재설치'}
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
                  )}
                  
                  {/* 버전 정보 표시 */}
                  {buttonState.installedVersion && buttonState.state !== 'installed' && (
                    <div className="text-xs text-center mt-2 flex items-center justify-center gap-1">
                      {buttonState.state === 'update' ? (
                        <>
                          <span className="text-gray-500">v{buttonState.installedVersion}</span>
                          <ArrowRight className="w-3 h-3 text-gray-400" />
                          <span className="text-green-400 font-medium">v{buttonState.selectedVersionNumber}</span>
                        </>
                      ) : buttonState.state === 'downgrade' ? (
                        <>
                          <AlertTriangle className="w-3 h-3 text-orange-400" />
                          <span className="text-orange-400">
                            v{buttonState.installedVersion} → v{buttonState.selectedVersionNumber}
                          </span>
                        </>
                      ) : buttonState.state === 'reinstall' ? (
                        <span className="text-blue-400">
                          v{buttonState.selectedVersionNumber} 재설치
                        </span>
                      ) : null}
                    </div>
                  )}
                  
                  {dependencies.filter(d => d.required).length > 0 && buttonState.state === 'install' && (
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
