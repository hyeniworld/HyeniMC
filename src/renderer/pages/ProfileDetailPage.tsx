import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount } from '../App';
import { ModList } from '../components/mods/ModList';
import { ResourcePackList } from '../components/resourcepacks/ResourcePackList';
import { ShaderPackList } from '../components/shaderpacks/ShaderPackList';
import { ProfileSettingsTab } from '../components/profiles/ProfileSettingsTab';
import { ExportHyeniPackModal } from '../components/profiles/ExportHyeniPackModal';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { isCreatorMode } from '../utils/appMode';
import { errorText } from '../utils/errorText';
import { WorkerModUpdatePanel } from '../components/worker-mods/WorkerModUpdatePanel';
import { HyeniPackSection } from '../components/hyeni/HyeniPackSection';
import { useWorkerModUpdates } from '../hooks/useWorkerModUpdates';
import { useDownloadStore } from '../store/downloadStore';
import { useToast } from '../contexts/ToastContext';
import { IPC_EVENTS } from '../../shared/constants/ipc';
import { FORCE_LAUNCH_MARKER } from '../../shared/constants/launch';
import { Package, Trash2, Loader2 } from 'lucide-react';

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
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  // 업데이트 확인 실패 시 강제 실행 확인 다이얼로그 메시지
  const [forceMsg, setForceMsg] = useState<string | null>(null);
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
    const cleanupModProgress = window.electronAPI.on(IPC_EVENTS.WORKER_MODS_UPDATE_PROGRESS, (data: any) => {
      console.log('[ProfileDetail] Mod update progress:', data);
      setDl({
        phase: 'mods',
        modName: data.modName,
        modProgress: data.progress,
        message: `${data.modName} 업데이트 중...`,
      });
    });

    // Listen for mod update error
    const cleanupModError = window.electronAPI.on(IPC_EVENTS.WORKER_MODS_UPDATE_ERROR, (data: any) => {
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
      if (!profileId) return;
      const loadedProfile = await window.electronAPI.profile.get(profileId);
      setProfile(loadedProfile);
    } catch (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
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

  const handleLaunch = React.useCallback(async (force = false) => {
    if (!profileId) return;

    // 계정 필수 — 오프라인 미지원(정품 서버 전용). 다운로드 시작 전에 안내.
    if (!selectedAccountId) {
      toast.warning('로그인 필요', 'Microsoft 계정으로 로그인해야 게임을 실행할 수 있습니다.');
      return;
    }

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
      await window.electronAPI.profile.launch(profileId, selectedAccountId, force);
      clearTimeout(timeoutId);
      // State will be updated by event listener
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Failed to launch:', error);
      setIsRunning(false);
      setIsLaunching(false);

      const raw = error instanceof Error ? error.message : String(error);
      // 업데이트 확인 실패(강제 실행 가능) → 다운로드 모달/토스트 대신 [강제 실행]/[닫기] 확인
      if (raw.includes(FORCE_LAUNCH_MARKER)) {
        resetDownload();
        setForceMsg(raw.split(FORCE_LAUNCH_MARKER)[1]?.trim() || '업데이트 서버에 연결할 수 없습니다.');
        return;
      }

      // 에러 상태 설정
      const errorMsg = errorText(error, '게임 실행에 실패했습니다.');
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

  const handleStop = () => setShowStopConfirm(true);

  const performStop = async () => {
    setShowStopConfirm(false);
    if (!profileId) return;
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
          ) : profile?.installationStatus && profile.installationStatus !== 'complete' ? (
            <button
              disabled
              className="px-6 py-3 rounded-lg font-semibold bg-gray-600 text-gray-300 cursor-not-allowed flex items-center gap-2"
              title="설치가 완료되지 않은 프로필입니다"
            >
              ⚠️ 실행 불가
            </button>
          ) : (
            <button
              onClick={() => handleLaunch()}
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

        {/* Installation Status Warning */}
        {profile?.installationStatus && profile.installationStatus !== 'complete' && (
          <div className={`mt-4 p-4 rounded-lg border-2 ${
            profile.installationStatus === 'installing' ? 'bg-yellow-900/20 border-yellow-500/50' : 'bg-red-900/20 border-red-500/50'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`text-2xl ${
                profile.installationStatus === 'installing' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                ⚠️
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${
                  profile.installationStatus === 'installing' ? 'text-yellow-300' : 'text-red-300'
                }`}>
                  {profile.installationStatus === 'installing' && '설치 진행 중'}
                  {profile.installationStatus === 'incomplete' && '설치 미완료'}
                  {profile.installationStatus === 'failed' && '설치 실패'}
                  {profile.installationStatus === 'delete-failed' && '삭제 실패'}
                </h3>
                <p className="text-sm text-gray-300 mb-2">
                  {profile.installationStatus === 'installing' && '이 프로필은 현재 모드팩 설치가 진행 중입니다. 설치가 완료될 때까지 기다려주세요.'}
                  {profile.installationStatus === 'incomplete' && '이 프로필은 모드팩 설치가 완료되지 않았습니다. 런처를 닫는 등의 이유로 설치가 중단되었을 수 있습니다.'}
                  {profile.installationStatus === 'failed' && '이 프로필의 모드팩 설치가 실패했습니다. 네트워크 연결을 확인하거나 다시 시도해주세요.'}
                  {profile.installationStatus === 'delete-failed' && '이 프로필은 삭제 도중 일부 파일이 지워지지 않아 불완전한 상태입니다. 다른 프로그램이 파일을 사용 중일 수 있으니, 잠시 후 다시 삭제해주세요.'}
                </p>
                <p className="text-sm text-gray-400">
                  {profile.installationStatus === 'delete-failed'
                    ? '이 프로필은 사용할 수 없습니다. 다시 삭제해주세요.'
                    : '이 프로필로는 게임을 실행할 수 없습니다. 프로필을 삭제하고 다시 생성해주세요.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab profile={profile} onReload={loadProfile} isRunning={isRunning} />}
        {activeTab === 'mods' && profileId && <ModList profileId={profileId} />}
        {activeTab === 'resourcepacks' && profileId && <ResourcePackList profileId={profileId} />}
        {activeTab === 'shaderpacks' && profileId && <ShaderPackList profileId={profileId} />}
        {activeTab === 'settings' && <ProfileSettingsTab profile={profile} onUpdate={loadProfile} />}
      </div>

      <ConfirmModal
        open={forceMsg !== null}
        title="업데이트 확인 실패"
        message={`${forceMsg ?? ''}\n\n그래도 강제로 실행하시겠습니까?`}
        confirmLabel="강제 실행"
        danger
        onConfirm={() => {
          setForceMsg(null);
          handleLaunch(true);
        }}
        onCancel={() => setForceMsg(null)}
      />
      <ConfirmModal
        open={showStopConfirm}
        title="게임 중단"
        message="정말로 게임을 중단하시겠습니까?"
        confirmLabel="중단"
        danger
        onConfirm={performStop}
        onCancel={() => setShowStopConfirm(false)}
      />
    </div>
  );
};

// Overview Tab
const OverviewTab: React.FC<{ profile: any; onReload: () => void; isRunning: boolean }> = ({ profile, onReload, isRunning }) => {
  const toast = useToast();
  const navigate = useNavigate();
  const { selectedAccountId } = useAccount();
  const [profilePath, setProfilePath] = useState<string>('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
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

  // Check for Worker Mods updates (multi-mod system)
  const {
    updates: workerModUpdates,
    hasUpdates: hasWorkerModUpdates,
    isInstalling: isInstallingWorkerMods,
    installProgress: workerModInstallProgress,
    installSelected: installWorkerMods,
    clearUpdates: clearWorkerModUpdates,
    error: workerModError,
  } = useWorkerModUpdates({
    profilePath,
    gameVersion: profile?.gameVersion || '',
    loaderType: profile?.loaderType || '',
    loaderVersion: profile?.loaderVersion || '',
    serverAddress: profile?.serverAddress,
    autoCheck: true,
    checkInterval: 30 * 60 * 1000 // 30 minutes
  });


  const handleWorkerModInstall = async (selectedModIds: string[]) => {
    const result = await installWorkerMods(selectedModIds);
    
    if (result.success) {
      toast.success('업데이트 완료', `${result.successCount}개 모드가 성공적으로 업데이트되었습니다.`);
    } else {
      // Show detailed error message
      const message = result.error || 
        `${result.successCount}/${result.totalCount}개 모드 업데이트 완료. ${result.totalCount - result.successCount}개 실패`;
      toast.error('업데이트 실패', message);
    }
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
    // 저장된 실제 인스턴스 경로 우선(userData 재구성보다 정확)
    const dir = profile?.gameDirectory || (await getInstancePath().catch(() => ''));
    if (!dir) {
      toast.error('오류', '프로필 정보가 올바르지 않습니다.');
      return;
    }
    // latest.log → logs 폴더 → 인스턴스 폴더 순으로 폴백(게임 미실행 시 로그 파일이 없을 수 있음)
    const candidates = [`${dir}/logs/latest.log`, `${dir}/logs`, dir];
    for (const target of candidates) {
      try {
        await window.electronAPI.shell.openPath(target);
        return;
      } catch (error) {
        console.warn('[Overview] openPath 실패, 폴백:', target, error);
      }
    }
    toast.error('오류', '로그를 찾을 수 없습니다. 게임을 한 번 실행해주세요.');
  };

  const handleExport = () => {
    setShowExportModal(true);
  };

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!profile?.id) return;
    setDeleting(true);
    try {
      await window.electronAPI.profile.delete(profile.id);
      toast.success('성공', '프로필이 삭제되었습니다.');
      navigate('/'); // 성공 시 이 페이지 언마운트 → 스피너 자연 종료
    } catch (error) {
      console.error('Failed to delete profile:', error);
      const msg = error instanceof Error ? error.message : '프로필 삭제에 실패했습니다.';
      toast.error('오류', msg);
      // 삭제 실패 시 백엔드가 '불완전'으로 표시했을 수 있으므로 프로필을 다시 불러와 안내를 노출한다.
      onReload();
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* 혜니팩 섹션 — 팩 프로필일 때만 렌더(온라인 배너 + 파일 업데이트) */}
      {profile?.id && (
        <HyeniPackSection
          profileId={profile.id}
          accountId={selectedAccountId ?? undefined}
          onUpdated={onReload}
        />
      )}

      {/* Worker Mods Update Panel (Multi-Mod System) */}
      {profilePath && hasWorkerModUpdates && (
        <WorkerModUpdatePanel
          updates={workerModUpdates}
          isInstalling={isInstallingWorkerMods}
          installProgress={workerModInstallProgress}
          onInstall={handleWorkerModInstall}
          onDismiss={clearWorkerModUpdates}
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
          {/* 혜니팩 내보내기는 제작자 전용 (사용자 런처에서 숨김) */}
          {isCreatorMode() && (
          <button
            onClick={handleExport}
            className="p-4 border border-gray-700 rounded-lg hover:bg-purple-900 hover:border-purple-800 transition-colors text-left"
          >
            <div className="flex items-center gap-2 text-2xl mb-2">
              <Package className="w-6 h-6 text-purple-400" />
            </div>
            <div className="font-medium text-gray-200">혜니팩 내보내기</div>
            <div className="text-xs text-gray-400">모드팩 파일로 저장</div>
          </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isRunning}
            title={isRunning ? '게임 실행 중에는 삭제할 수 없습니다. 먼저 게임을 종료하세요.' : undefined}
            className="p-4 border border-gray-700 rounded-lg hover:bg-red-900 hover:border-red-800 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-700"
          >
            <div className="flex items-center gap-2 text-2xl mb-2">
              <Trash2 className="w-6 h-6 text-red-400" />
            </div>
            <div className="font-medium text-gray-200">프로필 삭제</div>
            <div className="text-xs text-gray-400">
              {isRunning ? '게임 종료 후 가능' : '영구적으로 제거'}
            </div>
          </button>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && profile && (
        <ExportHyeniPackModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          profileId={profile.id}
          profileName={profile.name}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-red-400">프로필 삭제</h3>
            <p className="text-gray-300 mb-2">
              정말로 이 프로필을 삭제하시겠습니까?
            </p>
            <p className="text-sm text-gray-400 mb-4">
              모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete()}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {deleting ? (<><Loader2 className="w-4 h-4 animate-spin" /> 삭제 중...</>) : '삭제'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 btn-secondary disabled:opacity-60"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

