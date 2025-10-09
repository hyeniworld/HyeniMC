import React, { useState, createContext, useContext } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ProfileList } from './components/profiles/ProfileList';
import { ProfileDetailPage } from './pages/ProfileDetailPage';
import { AccountManager } from './components/accounts/AccountManager';
import { Sparkles } from 'lucide-react';

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

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<MainLayout />} />
          <Route path="/profile/:profileId" element={<ProfileDetailPage />} />
        </Routes>
      </HashRouter>
    </AccountContext.Provider>
  );
}

function MainLayout() {
  const { selectedAccountId, setSelectedAccountId } = useAccount();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-md sticky top-0 z-50 shadow-lg">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 via-pink-500 to-purple-600 rounded-xl shadow-lg flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
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
              <span className="text-sm text-gray-400 px-3 py-1 bg-gray-800/50 rounded-full border border-gray-700">
                v0.1.0
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <ProfileList />
      </main>
    
      {/* Footer */}
      <footer className="border-t border-gray-800 mt-auto">
        <div className="container mx-auto px-6 py-4">
          <p className="text-center text-sm text-gray-500">
            Made with <span className="text-red-500">❤️</span> for <span className="font-semibold text-gray-400">강혜니</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
