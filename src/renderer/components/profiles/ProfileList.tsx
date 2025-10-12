import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Settings, Trash2, Plus, FolderOpen, Clock, Loader2 } from 'lucide-react';
import { CreateProfileModal } from './CreateProfileModal';
import { useDownloadStore } from '../../store/downloadStore';
import { useAccount } from '../../App';
import { useToast } from '../../contexts/ToastContext';

export function ProfileList() {
  const navigate = useNavigate();
  const { selectedAccountId } = useAccount();
  const toast = useToast();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningProfiles, setRunningProfiles] = useState<Set<string>>(new Set());
  const [launchingProfiles, setLaunchingProfiles] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const showDownload = useDownloadStore(s => s.show);
  const setDl = useDownloadStore(s => s.setProgress);

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

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.electronAPI.profile.list();
      console.log('[ProfileList] Loaded profiles:', data);
      setProfiles(data || []);
    } catch (err) {
      console.error('Failed to load profiles:', err);
      setError(err instanceof Error ? err.message : '프로필을 불러오는데 실패했습니다.');
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async (profileId: string) => {
    try {
      const profile = profiles.find(p => p.id === profileId);
      if (!profile) return;

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
        // Pass accountId to launch
        await window.electronAPI.profile.launch(profileId, selectedAccountId);
        
        // global modal will auto-hide on game:started via hook
      } catch (err) {
        setDl({ error: err instanceof Error ? err.message : '알 수 없는 오류' });
        
        // Remove from launching on error
        setLaunchingProfiles(prev => {
          const ns = new Set(prev);
          return ns;
        });
      } finally {
        // no local listeners to cleanup (global hook handles events)
      }
  } catch (err) {
      console.error('Failed to launch profile:', err);
      // Remove from launching on error
      setLaunchingProfiles(prev => {
        const ns = new Set(prev);
        ns.delete(profileId);
        return ns;
      });
      // Surface error
      setDl({ error: err instanceof Error ? err.message : '알 수 없는 오류' });
    }
  };

  const handleStop = async (profileId: string) => {
    if (!confirm('정말로 게임을 중단하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.game.stop(profileId);
      toast.success('게임 중단', '게임이 종료되었습니다.');
    } catch (err) {
      console.error('Failed to stop game:', err);
      const errorMsg = err instanceof Error ? err.message : '게임 중단에 실패했습니다.';
      toast.error('중단 실패', errorMsg);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (!confirm('정말로 이 프로필을 삭제하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.profile.delete(profileId);
      toast.success('삭제 완료', '프로필이 삭제되었습니다.');
      await loadProfiles();
    } catch (err) {
      console.error('Failed to delete profile:', err);
      const errorMsg = err instanceof Error ? err.message : '프로필 삭제에 실패했습니다.';
      toast.error('삭제 실패', errorMsg);
    }
  };

  const handleCreateSuccess = () => {
    setShowCreateModal(false);
    loadProfiles();
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
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2 px-6 py-3 text-base font-semibold shadow-lg shadow-hyeni-pink-500/20 hover:shadow-hyeni-pink-500/40 transition-all"
        >
          <Plus className="w-5 h-5" />
          새 프로필
        </button>
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
              onClick={() => navigate(`/profile/${profile.id}`)}
              className="card hover:border-hyeni-pink-500 hover:shadow-lg hover:shadow-hyeni-pink-500/10 transition-all duration-200 group cursor-pointer"
            >
              {/* Profile Icon & Name */}
              <div className="flex items-start gap-4 mb-4">
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
                {launchingProfiles.has(profile.id) ? (
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(profile.id);
                  }}
                  className="btn-secondary p-3 hover:bg-red-900 hover:text-red-200 hover:border-red-800"
                  title="삭제"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Profile Modal */}
      {showCreateModal && (
        <CreateProfileModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />
      )}
    </div>
  );
}
