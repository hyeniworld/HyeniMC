import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, FolderOpen, Save, RefreshCw, Info } from 'lucide-react';

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
  // Memory settings
  const [minMemory, setMinMemory] = useState(profile?.memory?.min || 512);
  const [maxMemory, setMaxMemory] = useState(profile?.memory?.max || 4096);
  const [systemMemory] = useState(16384); // TODO: Get from system
  
  // Java settings
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [selectedJava, setSelectedJava] = useState<string>(profile?.javaPath || '');
  const [loadingJava, setLoadingJava] = useState(true);
  
  // JVM arguments
  const [jvmArgs, setJvmArgs] = useState(profile?.jvmArgs?.join(' ') || '');
  
  // Window settings
  const [windowWidth, setWindowWidth] = useState(profile?.resolution?.width || 854);
  const [windowHeight, setWindowHeight] = useState(profile?.resolution?.height || 480);
  const [fullscreen, setFullscreen] = useState(profile?.fullscreen || false);
  
  // Game directory
  const [gameDir, setGameDir] = useState(profile?.gameDirectory || '');
  
  // Icon
  const [icon, setIcon] = useState(profile?.icon || '🎮');
  
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setMinMemory(profile.memory?.min || 512);
      setMaxMemory(profile.memory?.max || 4096);
      setSelectedJava(profile.javaPath || '');
      setJvmArgs(profile.jvmArgs?.join(' ') || '');
      setWindowWidth(profile.resolution?.width || 854);
      setWindowHeight(profile.resolution?.height || 480);
      setFullscreen(profile.fullscreen || false);
      setGameDir(profile.gameDirectory || '');
      setIcon(profile.icon || '🎮');
    }
  }, [profile]);

  useEffect(() => {
    loadJavaInstallations();
  }, []);

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

  const handleSelectDirectory = async () => {
    try {
      const directory = await window.electronAPI.system.getPath('documents');
      setGameDir(directory);
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {
        memory: {
          min: minMemory,
          max: maxMemory,
        },
        javaPath: selectedJava,
        jvmArgs: jvmArgs.trim() ? jvmArgs.trim().split(/\s+/) : [],
        resolution: {
          width: windowWidth,
          height: windowHeight,
        },
        fullscreen,
        gameDirectory: gameDir,
        icon,
      };

      console.log('[ProfileSettings] Saving settings:', updates);
      await window.electronAPI.profile.update(profile.id, updates);
      
      alert('✅ 설정이 저장되었습니다!');
      onUpdate();
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('❌ 설정 저장에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
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

  return (
    <div className="p-6 space-y-6 max-w-4xl">
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

        <div className="space-y-6">
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

          {!fullscreen && (
            <>
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
            </>
          )}
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
