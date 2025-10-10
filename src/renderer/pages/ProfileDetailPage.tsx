import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../App';
import { ModList } from '../components/mods/ModList';
import { ResourcePackList } from '../components/resourcepacks/ResourcePackList';
import { ShaderPackList } from '../components/shaderpacks/ShaderPackList';
import { ProfileSettingsTab } from '../components/profiles/ProfileSettingsTab';

type TabType = 'overview' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'settings';

export const ProfileDetailPage: React.FC = () => {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { selectedAccountId } = useAccount();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (profileId) {
      loadProfile();
      checkRunningStatus();
      
      // Poll for running status every 2 seconds
      const interval = setInterval(() => {
        checkRunningStatus();
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [profileId]);

  useEffect(() => {
    // Listen for game started event
    const cleanupStarted = window.electronAPI.on('game:started', (data: any) => {
      console.log('[ProfileDetail] Game started:', data);
      if (data.versionId === profileId) {
        setIsRunning(true);
      }
    });

    // Listen for game stopped event
    const cleanupStopped = window.electronAPI.on('game:stopped', (data: any) => {
      console.log('[ProfileDetail] Game stopped:', data);
      if (data.versionId === profileId) {
        setIsRunning(false);
      }
    });

    return () => {
      cleanupStarted();
      cleanupStopped();
    };
  }, [profileId]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const profiles = await window.electronAPI.profile.list();
      const foundProfile = profiles.find((p: any) => p.id === profileId);
      setProfile(foundProfile || null);
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkRunningStatus = async () => {
    try {
      if (!profileId) return;
      const running = await window.electronAPI.game.isRunning(profileId);
      setIsRunning(running);
    } catch (error) {
      console.error('Failed to check running status:', error);
    }
  };

  const handleLaunch = async () => {
    if (!profileId) return;
    
    if (isRunning) {
      alert('이 프로필은 이미 실행 중입니다!');
      return;
    }

    try {
      await window.electronAPI.profile.launch(profileId, selectedAccountId);
      // State will be updated by event listener
    } catch (error) {
      console.error('Failed to launch:', error);
      setIsRunning(false);
      alert(error instanceof Error ? error.message : '게임 실행에 실패했습니다.');
    }
  };

  const handleStop = async () => {
    if (!profileId) return;

    if (!confirm('정말로 게임을 중단하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.game.stop(profileId);
      // State will be updated by event listener
    } catch (error) {
      console.error('Failed to stop game:', error);
      alert(error instanceof Error ? error.message : '게임 중단에 실패했습니다.');
    }
  };

  // Build tabs based on loader type
  const allTabs = [
    { id: 'overview', label: '개요', icon: '📋', showForVanilla: true },
    { id: 'mods', label: '모드', icon: '🔧', showForVanilla: false },
    { id: 'resourcepacks', label: '리소스팩', icon: '🎨', showForVanilla: true },
    { id: 'shaderpacks', label: '셰이더팩', icon: '✨', showForVanilla: false },
    { id: 'settings', label: '설정', icon: '⚙️', showForVanilla: true },
  ] as const;

  const isVanilla = profile?.loaderType === 'vanilla';
  const tabs = allTabs.filter(tab => !isVanilla || tab.showForVanilla);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">프로필을 찾을 수 없습니다</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              ← 뒤로
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                {profile.name}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {profile.gameVersion} · {profile.loaderType === 'vanilla' ? 'Vanilla' : 
                  profile.loaderType === 'fabric' ? `Fabric ${profile.loaderVersion || ''}` :
                  profile.loaderType === 'neoforge' ? `NeoForge ${profile.loaderVersion || ''}` :
                  profile.loaderType === 'quilt' ? `Quilt ${profile.loaderVersion || ''}` :
                  profile.loaderType}
              </p>
            </div>
          </div>

          {isRunning ? (
            <button
              onClick={handleStop}
              className="px-6 py-3 rounded-lg font-semibold transition-colors bg-red-600 hover:bg-red-700 text-white"
            >
              ⏹ 게임 중단
            </button>
          ) : (
            <button
              onClick={handleLaunch}
              className="px-6 py-3 rounded-lg font-semibold transition-colors bg-green-600 hover:bg-green-700 text-white"
            >
              ▶ 게임 실행
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab profile={profile} />}
        {activeTab === 'mods' && profileId && <ModList profileId={profileId} />}
        {activeTab === 'resourcepacks' && profileId && <ResourcePackList profileId={profileId} />}
        {activeTab === 'shaderpacks' && profileId && <ShaderPackList profileId={profileId} />}
        {activeTab === 'settings' && <ProfileSettingsTab profile={profile} onUpdate={loadProfile} />}
      </div>
    </div>
  );
};

// Overview Tab
const OverviewTab: React.FC<{ profile: any }> = ({ profile }) => {
  const getInstancePath = async () => {
    // Get userData path from electron
    const userData = await window.electronAPI.system.getPath('userData');
    return `${userData}/instances/${profile.id}`;
  };

  const handleOpenFolder = async () => {
    if (!profile?.id) {
      alert('프로필 정보가 올바르지 않습니다.');
      return;
    }

    try {
      const instancePath = await getInstancePath();
      console.log('[Overview] Opening folder:', instancePath);
      await window.electronAPI.shell.openPath(instancePath);
    } catch (error) {
      console.error('Failed to open folder:', error);
      alert('폴더 열기에 실패했습니다.');
    }
  };

  const handleShowLogs = async () => {
    if (!profile?.id) {
      alert('프로필 정보가 올바르지 않습니다.');
      return;
    }

    try {
      const instancePath = await getInstancePath();
      const logPath = `${instancePath}/logs/latest.log`;
      console.log('[Overview] Opening log:', logPath);
      await window.electronAPI.shell.openPath(logPath);
    } catch (error) {
      console.error('Failed to open logs:', error);
      alert('로그 파일을 찾을 수 없습니다. 게임을 한 번 실행해주세요.');
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
          프로필 정보
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">이름:</span>
            <span className="text-gray-800 dark:text-gray-200 font-medium">{profile.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">버전:</span>
            <span className="text-gray-800 dark:text-gray-200 font-medium">{profile.gameVersion}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">로더:</span>
            <span className="text-gray-800 dark:text-gray-200 font-medium">
              {profile.loaderType === 'vanilla' ? 'Vanilla' : 
                profile.loaderType === 'fabric' ? `Fabric ${profile.loaderVersion}` :
                profile.loaderType === 'neoforge' ? `NeoForge ${profile.loaderVersion}` :
                profile.loaderType === 'quilt' ? `Quilt ${profile.loaderVersion}` :
                profile.loaderType}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">생성일:</span>
            <span className="text-gray-800 dark:text-gray-200 font-medium">
              {new Date(profile.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
          빠른 작업
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={handleOpenFolder}
            className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
          >
            <div className="text-2xl mb-2">📁</div>
            <div className="font-medium text-gray-800 dark:text-gray-200">폴더 열기</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">게임 디렉토리 열기</div>
          </button>
          <button 
            onClick={handleShowLogs}
            className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
          >
            <div className="text-2xl mb-2">📋</div>
            <div className="font-medium text-gray-800 dark:text-gray-200">로그 보기</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">게임 로그 확인</div>
          </button>
        </div>
      </div>
    </div>
  );
};

