import React, { useState, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Link } from 'react-router-dom';
import { ProfileList } from './components/profiles/ProfileList';
import { ProfileDetailPage } from './pages/ProfileDetailPage';
import { AccountManager } from './components/accounts/AccountManager';
import { Sparkles } from 'lucide-react';
import { GlobalDownloadModal } from './components/common/GlobalDownloadModal';
import { SettingsPage } from './pages/SettingsPage';
import { useDownloadProgress } from './hooks/useDownloadProgress';
import { ToastProvider } from './contexts/ToastContext';
import { HyeniDecorations } from './components/common/HyeniDecorations';

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
      <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
        <HashRouter>
          <Routes>
            <Route path="/" element={<MainLayout />} />
            <Route path="/profile/:profileId" element={<ProfileDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </HashRouter>
        {/* Global Download/Install Modal (rich) */}
        <GlobalDownloadModal />
      </AccountContext.Provider>
    </ToastProvider>
  );
}

function MainLayout() {
  const { selectedAccountId, setSelectedAccountId } = useAccount();

  return (
    <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-md z-50 shadow-lg flex-shrink-0">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-4">
              {/* Account Manager */}
              <AccountManager
                selectedAccountId={selectedAccountId}
                onAccountChange={setSelectedAccountId}
              />
              <Link to="/settings" className="text-sm px-3 py-1 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 rounded-md">설정</Link>
              <span className="text-sm text-gray-400 px-3 py-1 bg-gray-800/50 rounded-full border border-gray-700">
                v0.1.0
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
          <ProfileList />
        </main>
      </div>
    
      {/* Footer */}
      <footer className="border-t border-gray-800 flex-shrink-0">
        <div className="container mx-auto px-6 py-2">
          <p className="text-center text-xs text-gray-600">
            Made with <span className="text-red-500">❤️</span> for <span className="font-semibold text-gray-500">강혜니</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
