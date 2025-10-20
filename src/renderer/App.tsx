import React, { useState, createContext, useContext, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, Outlet } from 'react-router-dom';
import { ProfileList } from './components/profiles/ProfileList';
import { ProfileDetailPage } from './pages/ProfileDetailPage';
import { AccountManager } from './components/accounts/AccountManager';
import { Sparkles } from 'lucide-react';
import { GlobalDownloadModal } from './components/common/GlobalDownloadModal';
import { SettingsPage } from './pages/SettingsPage';
import { useDownloadProgress } from './hooks/useDownloadProgress';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ErrorDialogProvider } from './contexts/ErrorDialogContext';
import { HyeniDecorations } from './components/common/HyeniDecorations';
import { useLauncherUpdate } from './hooks/useLauncherUpdate';
import { LauncherUpdateBanner } from './components/launcher/LauncherUpdateBanner';
import packageJson from '../../package.json';

// Global account context
interface AccountContextType {
  selectedAccountId?: string;
  setSelectedAccountId: (id: string | undefined) => void;
}

const AccountContext = createContext<AccountContextType>({
  selectedAccountId: undefined,
  setSelectedAccountId: () => {},
});

export const useAccount = () => useContext(AccountContext);

function App() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  // Init global download progress listeners
  useDownloadProgress();

  return (
    <ToastProvider>
      <ErrorDialogProvider>
        <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
          <HashRouter>
            <Routes>
              <Route path="/" element={<MainLayout />}>
                <Route index element={<ProfileList />} />
                <Route path="profile/:profileId" element={<ProfileDetailPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </HashRouter>
          {/* Global Download/Install Modal (rich) */}
          <GlobalDownloadModal />
        </AccountContext.Provider>
      </ErrorDialogProvider>
    </ToastProvider>
  );
}

function MainLayout() {
  const { selectedAccountId, setSelectedAccountId } = useAccount();
  const toast = useToast();
  const [isMacOS, setIsMacOS] = useState(false);
  
  // Launcher update state
  const {
    updateAvailable,
    updateInfo,
    isDownloading,
    downloadProgress,
    updateDownloaded,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
    formatBytes,
    formatSpeed
  } = useLauncherUpdate();

  // Detect macOS
  useEffect(() => {
    // Check if running on macOS
    setIsMacOS(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  // Listen for authentication events
  useEffect(() => {
    // Auth success
    const unsubSuccess = window.electronAPI.on('auth:success', (data: any) => {
      console.log('[App] Auth success:', data);
      toast.success(
        '✨ 혜니월드 인증 완료!',
        `${data.servers} 서버 인증이 완료되었습니다. (${data.profileCount}개 프로필)\n\nHyeniHelper 설정이 자동으로 업데이트되었습니다.`
      );
    });

    // Auth error
    const unsubError = window.electronAPI.on('auth:error', (data: any) => {
      console.error('[App] Auth error:', data);
      toast.error(
        '❌ 인증 실패',
        data.message
      );
    });

    return () => {
      unsubSuccess();
      unsubError();
    };
  }, [toast]);

  return (
    <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col overflow-hidden">
      {/* Launcher Update Banner */}
      {updateAvailable && updateInfo && (
        <LauncherUpdateBanner
          updateInfo={updateInfo}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          updateDownloaded={updateDownloaded}
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onDismiss={dismissUpdate}
          formatBytes={formatBytes}
          formatSpeed={formatSpeed}
        />
      )}

      {/* Header */}
      <header className={`border-b border-gray-800 bg-gray-900/80 backdrop-blur-md z-50 shadow-lg flex-shrink-0 transition-all duration-300 ${updateAvailable ? 'mt-[68px]' : ''}`}>
        <div className="container mx-auto px-6 py-4 relative">
          {/* macOS: Draggable area for window movement - covers entire header */}
          {isMacOS && (
            <div 
              className="absolute inset-0" 
              style={{ WebkitAppRegion: 'drag' } as any}
            />
          )}
          
          <div className="flex items-center justify-between relative z-10">
            <div className={`flex items-center gap-3 ${isMacOS ? 'ml-20' : ''}`}>
              <div className="w-10 h-10 bg-gradient-to-br from-hyeni-pink-600 via-hyeni-pink-500 to-hyeni-pink-600 rounded-xl shadow-lg flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-hyeni-pink-400 via-hyeni-pink-300 to-hyeni-pink-400 bg-clip-text text-transparent">
                  HyeniMC
                </h1>
                <p className="text-xs text-gray-500">혜니월드 전용 런처</p>
              </div>
            </div>
            <div className="flex items-center gap-4 relative" style={{ WebkitAppRegion: 'no-drag' } as any}>
              {/* Account Manager */}
              <AccountManager
                selectedAccountId={selectedAccountId}
                onAccountChange={setSelectedAccountId}
              />
              <Link to="/settings" className="text-sm px-3 py-1 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 rounded-md">설정</Link>
              <span className="text-sm text-gray-400 px-3 py-1 bg-gray-800/50 rounded-full border border-gray-700">
                v{packageJson.version}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 2-Column Layout: 캐릭터 영역 + 컨텐츠 영역 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽: 캐릭터 영역 */}
        <aside className="w-96 flex-shrink-0 bg-gradient-to-br from-gray-900/50 to-gray-950/50 border-r border-gray-800 relative overflow-hidden">
          <HyeniDecorations />
        </aside>

        {/* 오른쪽: 메인 컨텐츠 영역 */}
        <main className="flex-1 px-6 py-8 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    
      {/* Footer */}
      <footer className="border-t border-gray-800 flex-shrink-0">
        <div className="container mx-auto px-6 py-2">
          <p className="text-center text-xs text-gray-600">
            Made with <span className="text-red-500">❤️</span> for{' '}
            <button
              onClick={() => {
                if (window.electronAPI) {
                  window.electronAPI.shell.openExternal('https://chzzk.naver.com/3081b4db8cb8b6c1de194b66a5b81a67');
                }
              }}
              className="font-semibold text-hyeni-pink-400 hover:text-hyeni-pink-300 transition-colors cursor-pointer underline decoration-hyeni-pink-400/50 hover:decoration-hyeni-pink-300"
              title="강혜니 치지직 채널 방문하기"
            >
              강혜니
            </button>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
