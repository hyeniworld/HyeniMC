import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, FolderOpen, Save, RefreshCw, Info } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { isAuthorizedServer } from '@shared/config/server-config';

interface ProfileSettingsTabProps {
  profile: any;
  onUpdate: () => void;
}

interface JavaInstallation {
  path: string;
  version: string;
  majorVersion: number;
  vendor?: string;
  architecture: string;
}

export function ProfileSettingsTab({ profile, onUpdate }: ProfileSettingsTabProps) {
  const toast = useToast();
  // Global settings
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  
  // Profile basic info
  const [profileName, setProfileName] = useState(profile?.name || '');
  const [gameVersion, setGameVersion] = useState(profile?.gameVersion || '');
  const [versions, setVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [releaseOnly, setReleaseOnly] = useState(true);
  const [loaderType, setLoaderType] = useState<string>(profile?.loaderType || 'vanilla');
  const [loaderVersion, setLoaderVersion] = useState(profile?.loaderVersion || '');
  const [loaderVersions, setLoaderVersions] = useState<any[]>([]);
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [includeUnstableVersions, setIncludeUnstableVersions] = useState(false);
  
  // Memory settings
  const [useGlobalMemory, setUseGlobalMemory] = useState(!profile?.memory?.min && !profile?.memory?.max);
  const [minMemory, setMinMemory] = useState(profile?.memory?.min || 1024);
  const [maxMemory, setMaxMemory] = useState(profile?.memory?.max || 4096);
  const [systemMemory] = useState(16384); // TODO: Get from system
  
  // Java settings
  const [useGlobalJava, setUseGlobalJava] = useState(!profile?.javaPath);
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [selectedJava, setSelectedJava] = useState<string>(profile?.javaPath || '');
  const [loadingJava, setLoadingJava] = useState(true);
  
  // JVM arguments
  const [jvmArgs, setJvmArgs] = useState(profile?.jvmArgs?.join(' ') || '');
  
  // Window settings - fullscreen is part of resolution global setting
  const [useGlobalResolution, setUseGlobalResolution] = useState(!profile?.resolution?.width && !profile?.resolution?.height);
  const [windowWidth, setWindowWidth] = useState(profile?.resolution?.width || 854);
  const [windowHeight, setWindowHeight] = useState(profile?.resolution?.height || 480);
  const [fullscreen, setFullscreen] = useState(profile?.fullscreen || false);
  
  // Game directory
  const [gameDir, setGameDir] = useState(profile?.gameDirectory || '');
  
  // Icon
  const [icon, setIcon] = useState(profile?.icon || '🎮');
  
  // Server address (for HyeniHelper auth)
  const [serverAddress, setServerAddress] = useState(profile?.serverAddress || '');
  const [isHyeniWorldServer, setIsHyeniWorldServer] = useState(false);
  const [detectionSource, setDetectionSource] = useState<'profile' | 'servers.dat' | null>(null);
  
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGlobalSettings();
    loadJavaInstallations();
    checkServerDetection();
    loadMinecraftVersions();
  }, []);
  
  // Load Minecraft versions when releaseOnly changes
  useEffect(() => {
    loadMinecraftVersions();
  }, [releaseOnly]);
  
  // Check server detection when serverAddress or gameDir changes
  useEffect(() => {
    checkServerDetection();
  }, [serverAddress, gameDir]);
  
  // Load loader versions when loader type, game version, or includeUnstable changes
  useEffect(() => {
    if (loaderType && loaderType !== 'vanilla' && gameVersion) {
      loadLoaderVersions();
    } else {
      setLoaderVersions([]);
      setLoaderVersion('');
    }
  }, [loaderType, gameVersion, includeUnstableVersions]);

  // Initialize from profile (only when profile ID changes)
  useEffect(() => {
    if (profile) {
      setProfileName(profile.name || '');
      setGameVersion(profile.gameVersion || '');
      setLoaderType(profile.loaderType || 'vanilla');
      setLoaderVersion(profile.loaderVersion || '');
      
      const hasCustomMemory = profile.memory?.min > 0 || profile.memory?.max > 0;
      setUseGlobalMemory(!hasCustomMemory);
      setMinMemory(profile.memory?.min || 1024);
      setMaxMemory(profile.memory?.max || 4096);
      
      setUseGlobalJava(!profile.javaPath);
      setSelectedJava(profile.javaPath || '');
      
      // Resolution includes fullscreen
      const hasCustomResolution = profile.resolution?.width > 0 || profile.resolution?.height > 0;
      setUseGlobalResolution(!hasCustomResolution);
      setWindowWidth(profile.resolution?.width || 854);
      setWindowHeight(profile.resolution?.height || 480);
      setFullscreen(profile.fullscreen !== undefined && profile.fullscreen !== null ? profile.fullscreen : false);
      
      setJvmArgs(profile.jvmArgs?.join(' ') || '');
      setGameDir(profile.gameDirectory || '');
      setIcon(profile.icon || '🎮');
      setServerAddress(profile.serverAddress || '');
    }
  }, [profile?.id]);

  // Only update when global settings first load
  useEffect(() => {
    if (globalSettings && profile) {
      // Only apply global defaults if using global settings
      const hasCustomMemory = profile.memory?.min > 0 || profile.memory?.max > 0;
      if (!hasCustomMemory) {
        setMinMemory(globalSettings.java?.memory_min || 1024);
        setMaxMemory(globalSettings.java?.memory_max || 4096);
      }
      
      if (!profile.javaPath) {
        setSelectedJava(globalSettings.java?.java_path || '');
      }
      
      const hasCustomResolution = profile.resolution?.width > 0 || profile.resolution?.height > 0;
      if (!hasCustomResolution) {
        setWindowWidth(globalSettings.resolution?.width || 854);
        setWindowHeight(globalSettings.resolution?.height || 480);
        setFullscreen(globalSettings.resolution?.fullscreen || false);
      }
    }
  }, [globalSettings]);

  const loadGlobalSettings = async () => {
    try {
      const settings = await window.electronAPI.settings.get();
      setGlobalSettings(settings);
    } catch (error) {
      console.error('Failed to load global settings:', error);
    }
  };

  const loadJavaInstallations = async () => {
    try {
      setLoadingJava(true);
      const installations = await window.electronAPI.java.detect();
      setJavaInstallations(installations);
      
      // If no Java selected, use first one
      if (!selectedJava && installations.length > 0) {
        setSelectedJava(installations[0].path);
      }
    } catch (error) {
      console.error('Failed to detect Java:', error);
    } finally {
      setLoadingJava(false);
    }
  };
  
  const loadMinecraftVersions = async () => {
    try {
      setLoadingVersions(true);
      const versionList = await window.electronAPI.version.list(releaseOnly);
      setVersions(versionList);
      
      // If current gameVersion is not in the list, select the first one
      if (!versionList.includes(gameVersion) && versionList.length > 0) {
        setGameVersion(versionList[0]);
      }
    } catch (error) {
      console.error('Failed to load Minecraft versions:', error);
    } finally {
      setLoadingVersions(false);
    }
  };
  
  const checkServerDetection = () => {
    // Check profile serverAddress first (manual override)
    if (serverAddress?.trim()) {
      const isAuthorized = isAuthorizedServer(serverAddress);
      setIsHyeniWorldServer(isAuthorized);
      setDetectionSource(isAuthorized ? 'profile' : null);
      return;
    }
    
    // Note: servers.dat auto-detection happens at game launch time
    // We can't read it here without adding an IPC handler
    // For now, just show that auto-detection will happen
    setIsHyeniWorldServer(false);
    setDetectionSource(null);
  };
  
  const loadLoaderVersions = async () => {
    if (!gameVersion) return;
    
    try {
      setLoadingLoaderVersions(true);
      const result = await window.electronAPI.loader.getVersions(
        loaderType as any,
        gameVersion,
        includeUnstableVersions
      );
      
      if (result.success && result.versions) {
        setLoaderVersions(result.versions);
        
        // Check if profile has a loader version that's not in the current list
        const profileLoaderVersion = profile?.loaderVersion;
        const versionExists = result.versions.find((v: any) => v.version === profileLoaderVersion);
        
        if (profileLoaderVersion && !versionExists && !includeUnstableVersions) {
          // Profile has a version that's not in stable list
          // Automatically enable unstable versions to find it
          console.log(`[ProfileSettings] Loader version ${profileLoaderVersion} not found in stable list, enabling unstable versions`);
          setIncludeUnstableVersions(true);
          return; // useEffect will trigger reload with unstable versions
        }
        
        // If current version is not in list, select first one
        if (!loaderVersion || !result.versions.find((v: any) => v.version === loaderVersion)) {
          setLoaderVersion(result.versions[0]?.version || '');
        }
      }
    } catch (error) {
      console.error('Failed to load loader versions:', error);
      setLoaderVersions([]);
      setLoaderVersion('');
    } finally {
      setLoadingLoaderVersions(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const directory = await window.electronAPI.system.getPath('documents');
      setGameDir(directory);
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  // Handle checkbox changes - update values to global settings immediately
  const handleUseGlobalMemoryChange = (checked: boolean) => {
    setUseGlobalMemory(checked);
    if (checked && globalSettings) {
      setMinMemory(globalSettings.java?.memory_min || 1024);
      setMaxMemory(globalSettings.java?.memory_max || 4096);
    }
  };

  // Memory validation with debounce
  useEffect(() => {
    if (useGlobalMemory) return;
    
    if (minMemory > maxMemory) {
      const timer = setTimeout(() => {
        setMaxMemory(minMemory);
        toast.info('메모리 자동 조정', `최대 메모리가 ${minMemory}MB로 자동 조정되었습니다.`);
      }, 500);
      return () => clearTimeout(timer);
    } else if (maxMemory < minMemory) {
      const timer = setTimeout(() => {
        setMinMemory(maxMemory);
        toast.info('메모리 자동 조정', `최소 메모리가 ${maxMemory}MB로 자동 조정되었습니다.`);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [minMemory, maxMemory, useGlobalMemory, toast]);

  const handleUseGlobalJavaChange = (checked: boolean) => {
    setUseGlobalJava(checked);
    if (checked && globalSettings) {
      setSelectedJava(globalSettings.java?.java_path || '');
    }
  };

  const handleUseGlobalResolutionChange = (checked: boolean) => {
    setUseGlobalResolution(checked);
    if (checked && globalSettings) {
      setWindowWidth(globalSettings.resolution?.width || 854);
      setWindowHeight(globalSettings.resolution?.height || 480);
      setFullscreen(globalSettings.resolution?.fullscreen || false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Validate profile name
      if (!profileName.trim()) {
        toast.error('입력 오류', '프로필 이름을 입력하세요');
        setSaving(false);
        return;
      }
      
      // Validate loader version (바닐라가 아닌 경우)
      if (loaderType !== 'vanilla' && !loaderVersion) {
        toast.error('입력 오류', `${loaderType} 로더 버전을 선택하세요`);
        setSaving(false);
        return;
      }
      
      const updates: any = {
        name: profileName.trim(),
        gameVersion: gameVersion,
        loaderType: loaderType,
        loaderVersion: loaderType !== 'vanilla' ? loaderVersion : '',
        memory: {
          min: useGlobalMemory ? 0 : minMemory,  // 0 = use global settings
          max: useGlobalMemory ? 0 : maxMemory,
        },
        javaPath: useGlobalJava ? '' : selectedJava,  // empty = use global settings
        // Proto3 workaround: empty array is omitted during serialization
        // Use special marker to signal "clear jvmArgs"
        jvmArgs: jvmArgs.trim() ? jvmArgs.trim().split(/\s+/) : ['__CLEAR_JVM_ARGS__'],
        resolution: {
          width: useGlobalResolution ? 0 : windowWidth,  // 0 = use global settings
          height: useGlobalResolution ? 0 : windowHeight,
        },
        // Always send fullscreen (resolution=0,0 means use global including fullscreen)
        fullscreen: fullscreen,
        gameDirectory: gameDir,
        icon,
        serverAddress: serverAddress.trim(),
        // Preserve fields that are not editable in this UI
        favorite: profile.favorite ?? false,
        totalPlayTime: profile.totalPlayTime ?? 0,
        modpackId: profile.modpackId ?? '',
        modpackSource: profile.modpackSource ?? '',
        // Always include gameArgs to ensure jvmArgs empty array updates work
        // Proto3 serialization can fail if some array fields are undefined
        gameArgs: profile.gameArgs ?? [],
        description: profile.description ?? '',
      };
      await window.electronAPI.profile.update(profile.id, updates);
      
      toast.success('저장 성공', '설정이 저장되었습니다!');
      onUpdate();
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('저장 실패', '설정 저장에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const formatMemory = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  const iconOptions = ['🎮', '⚔️', '🛡️', '🏰', '🌲', '⛏️', '🔥', '💎', '🌟', '🎯', '🚀', '📦', '🎨', '🔧', '⚡'];

  const resolutionPresets = [
    { label: '854 × 480 (작음)', width: 854, height: 480 },
    { label: '1280 × 720 (HD)', width: 1280, height: 720 },
    { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
    { label: '2560 × 1440 (2K)', width: 2560, height: 1440 },
    { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  ];

  const loaderTypeOptions = [
    { value: 'vanilla', label: 'Vanilla (바닐라)' },
    { value: 'fabric', label: 'Fabric' },
    { value: 'forge', label: 'Forge' },
    { value: 'neoforge', label: 'NeoForge' },
    { value: 'quilt', label: 'Quilt' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Profile Name */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          ✏️ 프로필 이름
        </h3>
        <input
          type="text"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder="프로필 이름 입력"
          className="input w-full"
        />
      </div>

      {/* Minecraft Version */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          🎮 마인크래프트 버전
        </h3>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            게임 버전
          </label>
          <select
            value={gameVersion}
            onChange={(e) => setGameVersion(e.target.value)}
            className="input w-full"
            disabled={loadingVersions}
          >
            {loadingVersions ? (
              <option>버전 로딩 중...</option>
            ) : (
              versions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))
            )}
          </select>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <input
              id="releaseOnlyProfile"
              type="checkbox"
              checked={releaseOnly}
              onChange={(e) => {
                setLoadingVersions(true);
                setReleaseOnly(e.target.checked);
              }}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
            />
            <label htmlFor="releaseOnlyProfile" className="cursor-pointer">
              정식 버전만 보기
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            💡 마인크래프트 버전을 변경하면 로더 버전이 자동으로 호환 버전으로 변경됩니다
          </p>
        </div>
      </div>

      {/* Loader Settings */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          🔧 모드 로더 설정
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              로더 타입
            </label>
            <select
              value={loaderType}
              onChange={(e) => setLoaderType(e.target.value)}
              className="input w-full"
            >
              {loaderTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          
          {loaderType !== 'vanilla' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-300">
                  로더 버전
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeUnstableVersions}
                    onChange={(e) => setIncludeUnstableVersions(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
                  />
                  <span>불안정 버전 포함</span>
                </label>
              </div>
              {loadingLoaderVersions ? (
                <div className="input flex items-center gap-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  버전 로딩 중...
                </div>
              ) : loaderVersions.length === 0 ? (
                <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
                  <p className="text-sm text-yellow-300">
                    ⚠ 사용 가능한 로더 버전이 없습니다.
                  </p>
                  <p className="text-xs text-yellow-400 mt-1">
                    다른 Minecraft 버전을 선택하거나 바닐라를 사용하세요.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    value={loaderVersion}
                    onChange={(e) => setLoaderVersion(e.target.value)}
                    className="input w-full"
                    required
                  >
                    {loaderVersions.map((v: any, index: number) => {
                      const displayText = `${v.version}${v.stable ? ' (안정)' : ' (불안정)'}`;
                      return (
                        <option 
                          key={`${v.version}-${index}`} 
                          value={v.version}
                          className="bg-gray-800 text-white"
                        >
                          {displayText}
                        </option>
                      );
                    })}
                  </select>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      {loaderVersions.length}개의 버전 사용 가능
                    </span>
                    {loaderVersion && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        loaderVersions.find((v: any) => v.version === loaderVersion)?.stable
                          ? 'bg-green-900/30 text-green-300 border border-green-800'
                          : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'
                      }`}>
                        {loaderVersions.find((v: any) => v.version === loaderVersion)?.stable ? '안정' : '불안정'}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">
                💡 Minecraft {gameVersion}에 호환되는 {loaderType} 버전만 표시됩니다
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Profile Icon */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          🎨 프로필 아이콘
        </h3>
        <div className="flex items-center gap-4">
          <div className="text-6xl">{icon}</div>
          <div className="flex-1">
            <p className="text-sm text-gray-400 mb-3">프로필을 나타낼 아이콘을 선택하세요</p>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setIcon(emoji)}
                  className={`text-3xl p-2 rounded-lg transition-all hover:scale-110 ${
                    icon === emoji
                      ? 'bg-purple-500/30 ring-2 ring-purple-500'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Memory Settings */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-purple-400" />
          메모리 설정
        </h3>
        
        {/* Use Global Settings Checkbox */}
        <label className="flex items-center gap-3 mb-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={useGlobalMemory}
            onChange={(e) => handleUseGlobalMemoryChange(e.target.checked)}
            className="w-5 h-5 rounded border-gray-600 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
          />
          <div>
            <span className="text-gray-200 group-hover:text-white transition">전역 설정 사용</span>
            {useGlobalMemory && globalSettings && (
              <div className="text-xs text-gray-400 mt-0.5">
                전역: {formatMemory(globalSettings.java?.memory_min || 1024)} ~ {formatMemory(globalSettings.java?.memory_max || 4096)}
              </div>
            )}
          </div>
        </label>
        
        {!useGlobalMemory && (
          <>
            {/* System Info */}
            <div className="bg-gray-900/50 rounded-lg p-4 mb-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-gray-300 font-medium mb-1">시스템 메모리: {formatMemory(systemMemory)}</p>
                <p className="text-gray-400 text-xs">
                  권장: 최소 512MB, 최대 {formatMemory(Math.floor(systemMemory * 0.7))} (시스템 메모리의 70%)
                </p>
              </div>
            </div>
          </>
        )}

        <div className={`space-y-6 ${useGlobalMemory ? 'opacity-40 pointer-events-none' : ''}`}>
          {/* Min Memory Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                최소 메모리
              </label>
              <span className="text-sm font-bold text-purple-400">
                {formatMemory(minMemory)}
              </span>
            </div>
            <input
              type="range"
              min="256"
              max="8192"
              step="256"
              value={minMemory}
              onChange={(e) => setMinMemory(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>256 MB</span>
              <span>8 GB</span>
            </div>
          </div>

          {/* Max Memory Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                최대 메모리
              </label>
              <span className="text-sm font-bold text-purple-400">
                {formatMemory(maxMemory)}
              </span>
            </div>
            <input
              type="range"
              min="512"
              max={systemMemory}
              step="512"
              value={maxMemory}
              onChange={(e) => setMaxMemory(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>512 MB</span>
              <span>{formatMemory(systemMemory)}</span>
            </div>
          </div>

          {/* Memory Bar Visualization */}
          <div className="bg-gray-900/50 rounded-lg p-4">
            <div className="text-xs text-gray-400 mb-2">메모리 할당 시각화</div>
            <div className="h-6 bg-gray-800 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-gradient-to-r from-purple-600/50 to-purple-500/50 absolute"
                style={{ width: `${(minMemory / systemMemory) * 100}%` }}
              />
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 absolute"
                style={{ 
                  left: `${(minMemory / systemMemory) * 100}%`,
                  width: `${((maxMemory - minMemory) / systemMemory) * 100}%` 
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>최소</span>
              <span>할당 범위</span>
              <span>최대</span>
            </div>
          </div>
        </div>
      </div>

      {/* Java Settings */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-400" />
            Java 설정
          </h3>
          <button
            onClick={loadJavaInstallations}
            disabled={loadingJava}
            className="btn-secondary text-sm py-2 px-3 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loadingJava ? 'animate-spin' : ''}`} />
            재감지
          </button>
        </div>

        {/* Use Global Java Checkbox */}
        <label className="flex items-center gap-3 mb-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={useGlobalJava}
            onChange={(e) => handleUseGlobalJavaChange(e.target.checked)}
            className="w-5 h-5 rounded border-gray-600 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
          />
          <div>
            <span className="text-gray-200 group-hover:text-white transition">전역 설정 사용</span>
            {useGlobalJava && globalSettings?.java?.java_path && (
              <div className="text-xs text-gray-400 mt-0.5 truncate">
                전역: {globalSettings.java.java_path}
              </div>
            )}
          </div>
        </label>

        <div className={useGlobalJava ? 'opacity-40 pointer-events-none' : ''}>
        {loadingJava ? (
          <div className="text-center py-8 text-gray-400">
            Java 설치 경로를 감지하는 중...
          </div>
        ) : javaInstallations.length === 0 ? (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
            ⚠️ Java가 설치되어 있지 않습니다. 게임을 실행하려면 Java를 설치해야 합니다.
          </div>
        ) : (
          <div className="space-y-3">
            {javaInstallations.map((java, index) => (
              <button
                key={index}
                onClick={() => setSelectedJava(java.path)}
                className={`w-full text-left p-4 rounded-lg border transition-all ${
                  selectedJava === java.path
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      selectedJava === java.path ? 'bg-purple-500/20' : 'bg-gray-700'
                    }`}>
                      <Cpu className={`w-5 h-5 ${
                        selectedJava === java.path ? 'text-purple-400' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <div className="font-medium text-gray-200">
                        Java {java.majorVersion} ({java.architecture})
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {java.version}
                        {java.vendor && ` • ${java.vendor}`}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 font-mono truncate max-w-md">
                        {java.path}
                      </div>
                    </div>
                  </div>
                  {selectedJava === java.path && (
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* JVM Arguments */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          ⚙️ JVM 인자
        </h3>
        <div>
          <textarea
            value={jvmArgs}
            onChange={(e) => setJvmArgs(e.target.value)}
            placeholder="-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC"
            className="input resize-none font-mono text-sm"
            rows={3}
          />
          <p className="text-xs text-gray-500 mt-2">
            💡 고급 사용자 전용. 추가 JVM 인자를 입력하세요 (예: GC 옵션)
          </p>
        </div>
      </div>

      {/* Window Settings */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          🖥️ 창 설정
        </h3>
        
        <div className="space-y-4">
          {/* Use Global Resolution Checkbox (includes fullscreen) */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={useGlobalResolution}
              onChange={(e) => handleUseGlobalResolutionChange(e.target.checked)}
              className="w-5 h-5 rounded border-gray-600 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
            />
            <div>
              <span className="text-gray-200 group-hover:text-white transition">전역 창 설정 사용</span>
              {useGlobalResolution && globalSettings && (
                <div className="text-xs text-gray-400 mt-0.5">
                  전역: {globalSettings.resolution?.width || 854} × {globalSettings.resolution?.height || 480}, {globalSettings.resolution?.fullscreen ? '전체화면' : '창 모드'}
                </div>
              )}
            </div>
          </label>

          <div className={useGlobalResolution ? 'opacity-40 pointer-events-none' : ''}>
          {/* Fullscreen Toggle */}
          <label className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg cursor-pointer hover:bg-gray-900/70 transition-colors">
            <div>
              <div className="font-medium text-gray-200">전체화면</div>
              <div className="text-xs text-gray-400 mt-1">게임을 전체화면으로 시작</div>
            </div>
            <input
              type="checkbox"
              checked={fullscreen}
              onChange={(e) => setFullscreen(e.target.checked)}
              className="w-5 h-5 rounded accent-purple-500"
            />
          </label>

          {/* Resolution Presets */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              해상도 프리셋
            </label>
            <div className="grid grid-cols-2 gap-2">
              {resolutionPresets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setWindowWidth(preset.width);
                    setWindowHeight(preset.height);
                  }}
                  className={`p-3 rounded-lg text-sm font-medium transition-all ${
                    windowWidth === preset.width && windowHeight === preset.height
                      ? 'bg-purple-500/20 border-2 border-purple-500 text-purple-300'
                      : 'bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Resolution */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                너비 (px)
              </label>
              <input
                type="number"
                value={windowWidth}
                onChange={(e) => setWindowWidth(Number(e.target.value))}
                min="640"
                max="7680"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                높이 (px)
              </label>
              <input
                type="number"
                value={windowHeight}
                onChange={(e) => setWindowHeight(Number(e.target.value))}
                min="480"
                max="4320"
                className="input"
              />
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Server Address (HyeniHelper Integration) */}
      <div className="card border-2 border-hyeni-pink-500/30 bg-gradient-to-br from-hyeni-pink-900/10 to-transparent">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          🌟 혜니월드 서버 설정
        </h3>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            서버 주소
          </label>
          <input
            type="text"
            value={serverAddress}
            onChange={(e) => setServerAddress(e.target.value)}
            placeholder="예: play.hyeniworld.com"
            className="input w-full"
          />
          <div className="mt-3 space-y-3">
            {/* Server detection status */}
            <div className={`p-3 rounded-lg ${isHyeniWorldServer ? 'bg-green-900/20 border border-green-700/30' : 'bg-gray-800/50 border border-gray-700/30'}`}>
              <div className="flex items-center gap-2">
                {isHyeniWorldServer ? (
                  <>
                    <span className="text-green-400 text-lg">✅</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-400">
                        혜니월드 서버 감지됨 - 필수 모드 자동 업데이트 활성화
                      </p>
                      {detectionSource && (
                        <p className="text-xs text-gray-400 mt-1">
                          감지 방법: {detectionSource === 'profile' ? '프로필 설정 (수동 지정)' : 'servers.dat 자동 감지'}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Info className="w-4 h-4 text-gray-400" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-400">
                        {serverAddress?.trim() 
                          ? '일반 서버 - 모드 자동 업데이트 비활성화'
                          : '자동 감지 대기 중 - 게임 실행 시 servers.dat에서 확인'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Help text */}
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                💡 <strong>자동 감지:</strong> 멀티플레이 서버 목록에 혜니월드 서버가 
                있으면 자동으로 필수 모드를 업데이트합니다.
              </p>
              <p className="text-xs text-gray-400">
                🎯 <strong>수동 지정:</strong> 이 필드를 입력하면 자동 감지를 덮어씁니다.<br/>
                (예: 테스트 서버 강제 지정 시 사용)
              </p>
              <p className="text-xs text-green-400 font-medium">
                ✨ <strong>일반 사용자는 비워두셔도 됩니다!</strong> 자동으로 감지됩니다.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Game Directory */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-purple-400" />
          게임 디렉토리
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={gameDir}
            onChange={(e) => setGameDir(e.target.value)}
            placeholder="기본 디렉토리 사용"
            className="input flex-1 font-mono text-sm"
            readOnly
          />
          <button
            onClick={handleSelectDirectory}
            className="btn-secondary px-4 flex items-center gap-2 whitespace-nowrap"
          >
            <FolderOpen className="w-4 h-4" />
            변경
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          💡 비워두면 기본 디렉토리를 사용합니다
        </p>
      </div>

      {/* Save Button */}
      <div className="sticky bottom-6 pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary w-full py-4 text-base font-semibold shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {saving ? '저장 중...' : '설정 저장'}
        </button>
      </div>
    </div>
  );
}
