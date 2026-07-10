import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Play, Settings, Trash2, Plus, FolderOpen, Clock, Loader2, Star, Sparkles, Package, AlertTriangle } from 'lucide-react';
import { CreateProfileModal } from './CreateProfileModal';
import { ExportHyeniPackModal } from './ExportHyeniPackModal';
import { useDownloadStore } from '../../store/downloadStore';
import { useAccount } from '../../App';
import { useToast } from '../../contexts/ToastContext';
import { sortProfiles } from '../../utils/profileSorter';
import { DecorationCharacter } from '../common/HyeniDecorations';
import { ConfirmModal } from '../common/ConfirmModal';
import { errorText } from '../../utils/errorText';
import { isAuthorizedServer } from '@shared/config/server-config';
import { FORCE_LAUNCH_MARKER } from '@shared/constants/launch';

export function ProfileList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedAccountId } = useAccount();
  const toast = useToast();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningProfiles, setRunningProfiles] = useState<Set<string>>(new Set());
  const [launchingProfiles, setLaunchingProfiles] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  // 딥링크 제안('설치')으로 넘어온 혜니팩 id — 모달을 혜니팩 탭 + 자동 선택으로 연다.
  const [createHyeniPackId, setCreateHyeniPackId] = useState<string | undefined>(undefined);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingProfile, setExportingProfile] = useState<any>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 업데이트 확인 실패 시 강제 실행 확인 다이얼로그
  const [forcePrompt, setForcePrompt] = useState<{ profileId: string; message: string } | null>(null);
  const showDownload = useDownloadStore(s => s.show);
  const setDl = useDownloadStore(s => s.setProgress);
  const resetDownload = useDownloadStore(s => s.reset);

  useEffect(() => {
    loadProfiles();
    
    // Poll for active games every 2 seconds
    const pollActiveGames = async () => {
      try {
        const activeGames = await window.electronAPI.game.getActive();
        // Use profileId if available, otherwise use versionId for backward compatibility
        const activeIds = new Set<string>(activeGames.map(g => g.profileId || g.versionId));
        setRunningProfiles(activeIds);
      } catch (error) {
        console.error('Failed to poll active games:', error);
      }
    };
    
    const interval = setInterval(pollActiveGames, 2000);
    pollActiveGames(); // Initial poll
    
    // Listen for game started event
    const cleanupStarted = window.electronAPI.on('game:started', (data: any) => {
      console.log('[ProfileList] Game started:', data);
      if (data.versionId) {
        setRunningProfiles(prev => new Set(prev).add(data.versionId));
        // Remove from launching when started
        setLaunchingProfiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(data.versionId);
          return newSet;
        });
      }
    });

    // Listen for game stopped event
    const cleanupStopped = window.electronAPI.on('game:stopped', (data: any) => {
      console.log('[ProfileList] Game stopped:', data);
      if (data.versionId) {
        setRunningProfiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(data.versionId);
          return newSet;
        });
        
        // Update only the specific profile's play time (no full reload)
        setTimeout(async () => {
          try {
            const updatedProfile = await window.electronAPI.profile.get(data.versionId);
            setProfiles(prev => prev.map(p => 
              p.id === data.versionId ? updatedProfile : p
            ));
            console.log('[ProfileList] Updated play time for profile:', data.versionId);
          } catch (error) {
            console.error('[ProfileList] Failed to update profile:', error);
          }
        }, 1000); // Wait 1 second for backend to finish recording
      }
    });

    return () => {
      clearInterval(interval);
      cleanupStarted();
      cleanupStopped();
    };
  }, []);

  // 딥링크 제안('설치')으로 전달된 state.hyeniPackId 1회 소비 → 혜니팩 탭으로 모달 오픈.
  useEffect(() => {
    const packId = (location.state as { hyeniPackId?: string } | null)?.hyeniPackId;
    if (!packId) return;
    setCreateHyeniPackId(packId);
    setShowCreateModal(true);
    // state 클리어(뒤로가기/재마운트 시 재오픈 방지)
    navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.profile.list();
      console.log('[ProfileList] Loaded profiles:', data);
      // Apply sorting: favorite → lastPlayed → createdAt
      const sorted = sortProfiles(data || []);
      setProfiles(sorted);
    } catch (err) {
      console.error('Failed to load profiles:', err);
      setError(err instanceof Error ? err.message : '프로필을 불러오는데 실패했습니다.');
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async (profileId: string, force = false) => {
    try {
      const profile = profiles.find(p => p.id === profileId);
      if (!profile) return;

      // 계정 필수 — 오프라인 미지원(정품 서버 전용). 실행 준비 전에 안내.
      if (!selectedAccountId) {
        toast.warning('로그인 필요', 'Microsoft 계정으로 로그인해야 게임을 실행할 수 있습니다.');
        return;
      }

      // Check if already running
      if (runningProfiles.has(profileId)) {
        toast.warning('이미 실행 중', '이 프로필은 이미 실행 중입니다.');
        return;
      }

      // Check if already launching
      if (launchingProfiles.has(profileId)) {
        console.log('[ProfileList] Profile is already launching:', profileId);
        return;
      }

      // Mark as launching
      setLaunchingProfiles(prev => new Set(prev).add(profileId));

      // Trigger global download modal immediately with human-friendly title (profile name)
      showDownload(profile.name);
      setDl({ phase: 'precheck', percent: 0, message: '실행 준비 중...', versionId: profile.name });

      try {
        // Pass accountId + force to launch
        await window.electronAPI.profile.launch(profileId, selectedAccountId, force);

        // global modal will auto-hide on game:started via hook
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const clearLaunching = () =>
          setLaunchingProfiles(prev => {
            const ns = new Set(prev);
            ns.delete(profileId);
            return ns;
          });
        // 업데이트 확인 실패(강제 실행 가능) → 다운로드 모달 대신 [강제 실행]/[닫기] 확인 다이얼로그
        if (raw.includes(FORCE_LAUNCH_MARKER)) {
          resetDownload();
          clearLaunching();
          setForcePrompt({ profileId, message: raw.split(FORCE_LAUNCH_MARKER)[1]?.trim() || '업데이트 서버에 연결할 수 없습니다.' });
          return;
        }
        setDl({ error: errorText(err, '게임 실행에 실패했습니다.') });
        clearLaunching();
        setTimeout(() => resetDownload(), 3000);
      } finally {
        // no local listeners to cleanup (global hook handles events)
      }
  } catch (err) {
      console.error('Failed to launch profile:', err);
      const errorMsg = errorText(err, '게임 실행에 실패했습니다.');
      
      // Remove from launching on error
      setLaunchingProfiles(prev => {
        const ns = new Set(prev);
        ns.delete(profileId);
        return ns;
      });
      
      // Surface error
      setDl({ error: errorMsg });
      
      // 3초 후 자동으로 모달 닫기
      setTimeout(() => {
        resetDownload();
      }, 3000);
    }
  };

  const handleStop = (profileId: string) => setConfirmStopId(profileId);

  const performStop = async (profileId: string) => {
    setConfirmStopId(null);
    try {
      await window.electronAPI.game.stop(profileId);
      toast.success('게임 중단', '게임이 종료되었습니다.');
    } catch (err) {
      console.error('Failed to stop game:', err);
      const errorMsg = err instanceof Error ? err.message : '게임 중단에 실패했습니다.';
      toast.error('중단 실패', errorMsg);
    }
  };

  const handleDelete = (profileId: string) => setConfirmDeleteId(profileId);

  const performDelete = async (profileId: string) => {
    setConfirmDeleteId(null);
    setDeletingId(profileId);
    try {
      await window.electronAPI.profile.delete(profileId);
      toast.success('삭제 완료', '프로필이 삭제되었습니다.');
      await loadProfiles();
    } catch (err) {
      console.error('Failed to delete profile:', err);
      const errorMsg = err instanceof Error ? err.message : '프로필 삭제에 실패했습니다.';
      toast.error('삭제 실패', errorMsg);
      // 삭제 실패 시 백엔드가 프로필을 '불완전'으로 표시했을 수 있으므로 목록을 갱신해 안내를 노출한다.
      await loadProfiles();
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateSuccess = () => {
    setShowCreateModal(false);
    setCreateHyeniPackId(undefined);
    loadProfiles();
  };

  const handleCreateClose = () => {
    setShowCreateModal(false);
    setCreateHyeniPackId(undefined);
  };

  const handleToggleFavorite = async (profileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.profile.toggleFavorite(profileId);
      await loadProfiles(); // Reload and re-sort
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      const errorMsg = err instanceof Error ? err.message : '즐겨찾기 변경에 실패했습니다.';
      toast.error('오류', errorMsg);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-12 h-12 text-hyeni-pink-500 animate-spin" />
        <div className="text-gray-400 text-lg">프로필 불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-red-400 text-center">
          <p className="text-lg font-semibold mb-2">프로필을 불러올 수 없습니다</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
        <button onClick={loadProfiles} className="btn-primary">
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-2">프로필</h2>
          <p className="text-gray-400">마인크래프트 게임 프로필을 관리하세요</p>
        </div>
        <div className="flex items-center gap-4">
          {/* 데코레이션 캐릭터 */}
          <DecorationCharacter />
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 px-6 py-3 text-base font-semibold shadow-lg shadow-hyeni-pink-500/20 hover:shadow-hyeni-pink-500/40 transition-all"
          >
            <Plus className="w-5 h-5" />
            새 프로필
          </button>
        </div>
      </div>

      {/* Empty State */}
      {profiles.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-5 bg-gradient-to-br from-gray-900 to-gray-800 border-dashed">
          <div className="bg-gray-800 p-6 rounded-full">
            <FolderOpen className="w-16 h-16 text-gray-500" />
          </div>
          <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-300 mb-2">프로필이 없습니다</h3>
            <p className="text-gray-400 max-w-md">
              첫 프로필을 생성하여 마인크래프트를 시작해보세요
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2 mt-4 px-8 py-4 text-lg font-semibold shadow-lg shadow-hyeni-pink-500/30"
          >
            <Plus className="w-5 h-5" />
            첫 프로필 만들기
          </button>
        </div>
      ) : (
        /* Profile Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              onClick={() => { if (deletingId === profile.id) return; navigate(`/profile/${profile.id}`); }}
              className={`card hover:border-hyeni-pink-500 hover:shadow-lg hover:shadow-hyeni-pink-500/10 transition-all duration-200 group cursor-pointer relative ${
                profile.favorite ? 'ring-2 ring-yellow-400/50 bg-gradient-to-br from-yellow-900/10' : ''
              }`}
            >
              {/* 삭제 중 오버레이 (파일 정리 동안 표시 — 프리즈 대신 명시적 피드백) */}
              {deletingId === profile.id && (
                <div
                  className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm rounded-xl flex items-center justify-center z-30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 text-gray-200 text-sm font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" /> 삭제 중...
                  </div>
                </div>
              )}

              {/* Favorite Badge */}
              {profile.favorite && (
                <div className="absolute top-0 left-0 px-2 py-0.5 bg-yellow-400 text-black text-xs font-semibold rounded-br">
                  즐겨찾기
                </div>
              )}
              
              {/* Installation Status Badge */}
              {profile.installationStatus && profile.installationStatus !== 'complete' && (
                <div className="absolute top-2 left-2 px-2 py-1 bg-red-500/90 backdrop-blur-sm text-white text-xs font-semibold rounded-full flex items-center gap-1 shadow-lg z-20">
                  <AlertTriangle className="w-3 h-3" />
                  <span>
                    {profile.installationStatus === 'installing' && '설치 중'}
                    {profile.installationStatus === 'failed' && '설치 실패'}
                    {profile.installationStatus === 'incomplete' && '설치 미완료'}
                    {profile.installationStatus === 'delete-failed' && '삭제 실패'}
                  </span>
                </div>
              )}
              
              {/* Authorized Server Badge */}
              {profile.serverAddress && isAuthorizedServer(profile.serverAddress) && !profile.installationStatus && (
                <div className="absolute top-2 left-2 px-2 py-1 bg-gradient-to-r from-hyeni-pink-500/90 to-purple-500/90 backdrop-blur-sm text-white text-xs font-semibold rounded-full flex items-center gap-1 shadow-lg">
                  <Sparkles className="w-3 h-3" />
                  <span>필수 모드 자동 관리</span>
                </div>
              )}
              
              {/* Favorite Button */}
              <button
                onClick={(e) => handleToggleFavorite(profile.id, e)}
                className="absolute top-2 right-2 p-1.5 rounded hover:bg-gray-700 transition-colors z-10"
                title={profile.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              >
                {profile.favorite ? (
                  <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                ) : (
                  <Star className="w-5 h-5 text-gray-500 hover:text-gray-300" />
                )}
              </button>
              {/* Profile Icon & Name */}
              <div className="flex items-start gap-4 mb-4 pt-6">
                <div className="w-20 h-20 bg-gradient-to-br from-hyeni-pink-600 via-hyeni-pink-500 to-hyeni-pink-600 rounded-xl flex items-center justify-center text-3xl font-bold shadow-lg group-hover:scale-105 transition-transform">
                  {profile.icon || profile.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <h3 className="text-xl font-bold truncate mb-1 group-hover:text-hyeni-pink-400 transition-colors">
                    {profile.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-0.5 bg-hyeni-pink-500/20 text-hyeni-pink-300 rounded font-medium">
                      {profile.gameVersion}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded font-medium">
                      {profile.loaderType}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              {profile.description && (
                <p className="text-sm text-gray-400 mb-4 line-clamp-2 leading-relaxed">
                  {profile.description}
                </p>
              )}

              {/* Installation Status Warning */}
              {profile.installationStatus && profile.installationStatus !== 'complete' && (
                <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs">
                      <p className="text-red-300 font-semibold mb-1">
                        {profile.installationStatus === 'installing' && '모드팩 설치가 진행 중이었습니다'}
                        {profile.installationStatus === 'failed' && '모드팩 설치에 실패했습니다'}
                        {profile.installationStatus === 'incomplete' && '모드팩이 정상적으로 설치되지 않았습니다'}
                        {profile.installationStatus === 'delete-failed' && '삭제에 실패한 불완전한 프로필입니다'}
                      </p>
                      <p className="text-red-400">
                        {profile.installationStatus === 'delete-failed'
                          ? '일부 파일이 지워지지 않았습니다. 잠시 후 다시 삭제해주세요.'
                          : '이 프로필은 플레이할 수 없습니다. 프로필을 삭제하고 다시 설치해주세요.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4 pb-4 border-b border-gray-800">
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{Math.floor(profile.totalPlayTime / 60)}분 플레이</span>
                </div>
                {profile.lastPlayed && (
                  <span className="text-gray-600">
                    최근 {new Date(profile.lastPlayed).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {profile.installationStatus && profile.installationStatus !== 'complete' ? (
                  <button
                    disabled
                    className="flex-1 flex items-center justify-center gap-2 py-3 font-semibold bg-gray-700 text-gray-500 rounded-lg shadow-md cursor-not-allowed"
                    title="설치가 완료되지 않은 프로필입니다"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    플레이 불가
                  </button>
                ) : launchingProfiles.has(profile.id) ? (
                  <button
                    disabled
                    className="flex-1 flex items-center justify-center gap-2 py-3 font-semibold bg-gray-700 text-gray-400 rounded-lg shadow-md cursor-not-allowed"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    시작 중...
                  </button>
                ) : runningProfiles.has(profile.id) ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStop(profile.id);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-md transition-all"
                  >
                    <Loader2 className="w-4 h-4" />
                    중단하기
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunch(profile.id);
                    }}
                    className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 font-semibold shadow-md shadow-hyeni-pink-500/20 hover:shadow-hyeni-pink-500/40"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    플레이
                  </button>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/profile/${profile.id}`);
                  }}
                  className="btn-secondary p-3 hover:bg-gray-700"
                  title="설정"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Profile Modal */}
      {showCreateModal && (
        <CreateProfileModal
          onClose={handleCreateClose}
          onSuccess={handleCreateSuccess}
          initialTab={createHyeniPackId ? 'hyenipack' : undefined}
          initialHyeniPackId={createHyeniPackId}
        />
      )}

      {/* Export HyeniPack Modal */}
      {showExportModal && exportingProfile && (
        <ExportHyeniPackModal
          isOpen={showExportModal}
          onClose={() => {
            setShowExportModal(false);
            setExportingProfile(null);
          }}
          profileId={exportingProfile.id}
          profileName={exportingProfile.name}
        />
      )}

      <ConfirmModal
        open={forcePrompt !== null}
        title="업데이트 확인 실패"
        message={`${forcePrompt?.message ?? ''}\n\n그래도 강제로 실행하시겠습니까?`}
        confirmLabel="강제 실행"
        danger
        onConfirm={() => {
          const id = forcePrompt?.profileId;
          setForcePrompt(null);
          if (id) handleLaunch(id, true);
        }}
        onCancel={() => setForcePrompt(null)}
      />
      <ConfirmModal
        open={confirmStopId !== null}
        title="게임 중단"
        message="정말로 게임을 중단하시겠습니까?"
        confirmLabel="중단"
        danger
        onConfirm={() => confirmStopId && performStop(confirmStopId)}
        onCancel={() => setConfirmStopId(null)}
      />
      <ConfirmModal
        open={confirmDeleteId !== null}
        title="프로필 삭제"
        message="정말로 이 프로필을 삭제하시겠습니까? 모든 데이터가 영구 삭제됩니다."
        confirmLabel="삭제"
        danger
        onConfirm={() => confirmDeleteId && performDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
