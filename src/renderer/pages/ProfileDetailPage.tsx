import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../App';
import { ModList } from '../components/mods/ModList';
import { ResourcePackList } from '../components/resourcepacks/ResourcePackList';
import { ShaderPackList } from '../components/shaderpacks/ShaderPackList';
import { ProfileSettingsTab } from '../components/profiles/ProfileSettingsTab';
import { HyeniUpdateNotification } from '../components/hyeni/HyeniUpdateNotification';
import { useHyeniUpdate } from '../hooks/useHyeniUpdate';
import { useDownloadStore } from '../store/downloadStore';
import { useToast } from '../contexts/ToastContext';

type TabType = 'overview' | 'mods' | 'resourcepacks' | 'shaderpacks' | 'settings';

export const ProfileDetailPage: React.FC = () => {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { selectedAccountId } = useAccount();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const showDownload = useDownloadStore(s => s.show);
  const setDl = useDownloadStore(s => s.setProgress);
  const resetDownload = useDownloadStore(s => s.reset);

  useEffect(() => {
    if (!profileId) return;
    loadProfile();
    checkRunningStatus();
    const interval = setInterval(checkRunningStatus, 3000);
    return () => clearInterval(interval);
  }, [profileId]);

  useEffect(() => {
    // Listen for game started event
    const cleanupStarted = window.electronAPI.on('game:started', (data: any) => {
      console.log('[ProfileDetail] Game started:', data);
      if (data.versionId === profileId) {
        setIsRunning(true);
        setIsLaunching(false);
      }
    });

    // Listen for game stopped event
    const cleanupStopped = window.electronAPI.on('game:stopped', (data: any) => {
      console.log('[ProfileDetail] Game stopped:', data);
      if (data.versionId === profileId) {
        setIsRunning(false);
        
        // Update only the play time (no full reload)
        setTimeout(async () => {
          try {
            if (!profileId) return;
            const updatedProfile = await window.electronAPI.profile.get(profileId);
            setProfile(updatedProfile);
            console.log('[ProfileDetail] Updated play time');
          } catch (error) {
            console.error('[ProfileDetail] Failed to update profile:', error);
          }
        }, 1000); // Wait 1 second for backend to finish recording
      }
    });

    // Listen for mod update progress
    const cleanupModProgress = window.electronAPI.on('mod:update-progress', (data: any) => {
      console.log('[ProfileDetail] Mod update progress:', data);
      setDl({
        phase: 'mods',
        modName: data.modName,
        modProgress: data.progress,
        message: `${data.modName} 업데이트 중...`,
      });
    });

    // Listen for mod update error
    const cleanupModError = window.electronAPI.on('mod:update-error', (data: any) => {
      console.error('[ProfileDetail] Mod update error:', data);
      setIsLaunching(false);
      const errorMsg = data.message || '모드 업데이트에 실패했습니다.';
      setDl({ error: errorMsg });
      toast.error('모드 업데이트 실패', errorMsg);
      
      // 3초 후 자동으로 모달 닫기
      setTimeout(() => {
        resetDownload();
      }, 3000);
    });

    return () => {
      cleanupStarted();
      cleanupStopped();
      cleanupModProgress();
      cleanupModError();
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

  const handleLaunch = React.useCallback(async () => {
    if (!profileId) return;
    
    if (isRunning) {
      toast.warning('실행 중', '이 프로필은 이미 실행 중입니다!');
      return;
    }

    if (isLaunching) {
      console.log('[ProfileDetail] Already launching');
      return;
    }

    setIsLaunching(true);
    // Immediately surface global download modal for feedback
    showDownload(profileId);
    setDl({ phase: 'precheck', percent: 0, message: '실행 준비 중...' });

    // 타임아웃 설정 (60초)
    const timeoutId = setTimeout(() => {
      if (isLaunching) {
        console.error('[ProfileDetail] Launch timeout');
        setIsLaunching(false);
        const errorMsg = '게임 실행 시간이 초과되었습니다. (60초)\n\n다시 시도해주세요.';
        setDl({ error: errorMsg });
        toast.error('실행 시간 초과', '60초 내에 응답이 없습니다.');
        
        // 3초 후 자동으로 모달 닫기
        setTimeout(() => {
          resetDownload();
        }, 3000);
      }
    }, 60000);

    try {
      await window.electronAPI.profile.launch(profileId, selectedAccountId);
      clearTimeout(timeoutId);
      // State will be updated by event listener
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Failed to launch:', error);
      setIsRunning(false);
      setIsLaunching(false);
      
      // 에러 상태 설정
      const errorMsg = error instanceof Error ? error.message : '게임 실행에 실패했습니다.';
      setDl({ error: errorMsg });
      toast.error('실행 실패', errorMsg);
      
      // 3초 후 자동으로 모달 닫기
      setTimeout(() => {
        resetDownload();
      }, 3000);
    }
  }, [profileId, isRunning, isLaunching, selectedAccountId, showDownload, setDl, resetDownload]);

  // 재시도 이벤트 리스너
  useEffect(() => {
    const handleRetry = () => {
      console.log('[ProfileDetail] Retry requested');
      handleLaunch();
    };

    window.addEventListener('retry-game-launch', handleRetry);
    return () => {
      window.removeEventListener('retry-game-launch', handleRetry);
    };
  }, [handleLaunch]);

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
      toast.error('중단 실패', error instanceof Error ? error.message : '게임 중단에 실패했습니다.');
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              ← 뒤로
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-200">
                {profile.name}
              </h1>
              <p className="text-sm text-gray-400">
                {profile.gameVersion} · {profile.loaderType === 'vanilla' ? 'Vanilla' : 
                  profile.loaderType === 'fabric' ? `Fabric ${profile.loaderVersion || ''}` :
                  profile.loaderType === 'neoforge' ? `NeoForge ${profile.loaderVersion || ''}` :
                  profile.loaderType === 'quilt' ? `Quilt ${profile.loaderVersion || ''}` :
                  profile.loaderType}
              </p>
            </div>
          </div>

          {isLaunching ? (
            <button
              disabled
              className="px-6 py-3 rounded-lg font-semibold bg-gray-600 text-gray-300 cursor-not-allowed flex items-center gap-2"
            >
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              시작 중...
            </button>
          ) : isRunning ? (
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
                  ? 'bg-hyeni-pink-600 text-white'
                  : 'text-gray-400 hover:bg-gray-700'
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
  const toast = useToast();
  const [profilePath, setProfilePath] = useState<string>('');
  
  const getInstancePath = async () => {
    // Get userData path from electron
    const userData = await window.electronAPI.system.getPath('userData');
    return `${userData}/instances/${profile.id}`;
  };

  useEffect(() => {
    if (profile?.id) {
      getInstancePath().then(setProfilePath);
    }
  }, [profile?.id]);

  // Check for HyeniHelper updates
  const {
    updateInfo,
    isChecking,
    checkForUpdate,
    clearUpdate
  } = useHyeniUpdate({
    profilePath,
    gameVersion: profile?.gameVersion || '',
    loaderType: profile?.loaderType || '',
    autoCheck: true,
    checkInterval: 30 * 60 * 1000 // 30 minutes
  });

  const handleUpdateComplete = () => {
    toast.success('업데이트 완료', 'HyeniHelper가 성공적으로 업데이트되었습니다.');
    clearUpdate();
    checkForUpdate(); // Re-check to confirm
  };

  const handleOpenFolder = async () => {
    if (!profile?.id) {
      toast.error('오류', '프로필 정보가 올바르지 않습니다.');
      return;
    }

    try {
      const instancePath = await getInstancePath();
      console.log('[Overview] Opening folder:', instancePath);
      await window.electronAPI.shell.openPath(instancePath);
    } catch (error) {
      console.error('Failed to open folder:', error);
      toast.error('오류', '폴더 열기에 실패했습니다.');
    }
  };

  const handleShowLogs = async () => {
    if (!profile?.id) {
      toast.error('오류', '프로필 정보가 올바르지 않습니다.');
      return;
    }

    try {
      const instancePath = await getInstancePath();
      const logPath = `${instancePath}/logs/latest.log`;
      console.log('[Overview] Opening log:', logPath);
      await window.electronAPI.shell.openPath(logPath);
    } catch (error) {
      console.error('Failed to open logs:', error);
      toast.error('오류', '로그 파일을 찾을 수 없습니다. 게임을 한 번 실행해주세요.');
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* HyeniHelper Update Notification */}
      {profilePath && updateInfo && (
        <HyeniUpdateNotification
          profileId={profile.id}
          profilePath={profilePath}
          gameVersion={profile.gameVersion}
          loaderType={profile.loaderType}
          updateInfo={updateInfo}
          onUpdateComplete={handleUpdateComplete}
          onDismiss={clearUpdate}
        />
      )}
      <div className="bg-gray-800 rounded-lg p-6 shadow border border-gray-700">
        <h2 className="text-xl font-semibold text-gray-200 mb-4">
          프로필 정보
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">이름:</span>
            <span className="text-gray-200 font-medium">{profile.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">버전:</span>
            <span className="text-gray-200 font-medium">{profile.gameVersion}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">로더:</span>
            <span className="text-gray-200 font-medium">
              {profile.loaderType === 'vanilla' ? 'Vanilla' : 
                profile.loaderType === 'fabric' ? `Fabric ${profile.loaderVersion}` :
                profile.loaderType === 'neoforge' ? `NeoForge ${profile.loaderVersion}` :
                profile.loaderType === 'quilt' ? `Quilt ${profile.loaderVersion}` :
                profile.loaderType}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">생성일:</span>
            <span className="text-gray-200 font-medium">
              {new Date(profile.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 shadow border border-gray-700">
        <h2 className="text-xl font-semibold text-gray-200 mb-4">
          빠른 작업
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={handleOpenFolder}
            className="p-4 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors text-left"
          >
            <div className="text-2xl mb-2">📁</div>
            <div className="font-medium text-gray-200">폴더 열기</div>
            <div className="text-xs text-gray-400">게임 디렉토리 열기</div>
          </button>
          <button 
            onClick={handleShowLogs}
            className="p-4 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors text-left"
          >
            <div className="text-2xl mb-2">📋</div>
            <div className="font-medium text-gray-200">로그 보기</div>
            <div className="text-xs text-gray-400">게임 로그 확인</div>
          </button>
        </div>
      </div>
    </div>
  );
};

