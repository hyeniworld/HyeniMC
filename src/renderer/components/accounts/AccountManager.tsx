import React, { useState, useEffect } from 'react';
import { User, UserPlus, Trash2, LogIn, ChevronDown } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  skin?: string;
  lastUsed?: number;
}

interface AccountManagerProps {
  selectedAccountId?: string;
  onAccountChange: (accountId: string | undefined) => void;
}

export function AccountManager({ selectedAccountId, onAccountChange }: AccountManagerProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [offlineUsername, setOfflineUsername] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const accountList = await window.electronAPI.account.list();
      setAccounts(accountList);
      
      // Auto-select first account if none selected
      if (!selectedAccountId && accountList.length > 0) {
        onAccountChange(accountList[0].id);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    setShowDropdown(false);
    try {
      const account = await window.electronAPI.account.loginMicrosoft();
      await loadAccounts();
      onAccountChange(account.id);
    } catch (error: any) {
      alert(error.message || 'Microsoft 로그인에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleAddOffline = async () => {
    if (!offlineUsername.trim()) {
      alert('사용자 이름을 입력해주세요');
      return;
    }

    setLoading(true);
    try {
      const account = await window.electronAPI.account.addOffline(offlineUsername.trim());
      await loadAccounts();
      onAccountChange(account.id);
      setShowOfflineModal(false);
      setOfflineUsername('');
    } catch (error: any) {
      alert(error.message || '오프라인 계정 추가에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAccount = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('이 계정을 삭제하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.account.remove(accountId);
      if (selectedAccountId === accountId) {
        onAccountChange(undefined);
      }
      await loadAccounts();
    } catch (error: any) {
      alert(error.message || '계정 삭제에 실패했습니다');
    }
  };

  const selectedAccount = accounts.find(acc => acc.id === selectedAccountId);

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 hover:bg-gray-700/80 rounded-lg border border-gray-700 transition-all disabled:opacity-50"
        >
          {selectedAccount ? (
            <>
              {selectedAccount.skin ? (
                <img
                  src={selectedAccount.skin}
                  alt={selectedAccount.name}
                  className="w-6 h-6 rounded"
                />
              ) : (
                <div className="w-6 h-6 bg-gray-700 rounded flex items-center justify-center">
                  <User className="w-4 h-4 text-gray-400" />
                </div>
              )}
              <span className="text-sm font-medium">{selectedAccount.name}</span>
              {selectedAccount.type === 'microsoft' && (
                <span className="text-xs text-blue-400">🔐</span>
              )}
            </>
          ) : (
            <>
              <User className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-400">계정 없음</span>
            </>
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-50 max-h-96 overflow-y-auto">
              {/* Default Account */}
              <div
                onClick={() => {
                  onAccountChange(undefined);
                  setShowDropdown(false);
                }}
                className={`p-3 hover:bg-gray-700/50 cursor-pointer transition-colors ${
                  !selectedAccountId ? 'bg-purple-500/10 border-l-4 border-purple-500' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center">
                    <User className="w-5 h-5 text-gray-400" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">Player</div>
                    <div className="text-xs text-gray-400">오프라인 (기본)</div>
                  </div>
                </div>
              </div>

              {/* Account List */}
              {accounts.map((account) => (
                <div
                  key={account.id}
                  onClick={() => {
                    onAccountChange(account.id);
                    setShowDropdown(false);
                  }}
                  className={`p-3 hover:bg-gray-700/50 cursor-pointer transition-colors ${
                    selectedAccountId === account.id ? 'bg-purple-500/10 border-l-4 border-purple-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {account.skin ? (
                        <img
                          src={account.skin}
                          alt={account.name}
                          className="w-8 h-8 rounded"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center">
                          <User className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-sm">{account.name}</div>
                        <div className="text-xs text-gray-400">
                          {account.type === 'microsoft' ? (
                            <span className="text-blue-400">🔐 Microsoft</span>
                          ) : (
                            <span className="text-gray-500">오프라인</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleRemoveAccount(account.id, e)}
                      className="p-1 hover:bg-red-600/20 rounded text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Divider */}
              <div className="border-t border-gray-700 my-1" />

              {/* Add Account Buttons */}
              <div className="p-2 space-y-1">
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    handleMicrosoftLogin();
                  }}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  Microsoft 로그인
                </button>
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setShowOfflineModal(true);
                  }}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  오프라인 계정 추가
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add Offline Account Modal */}
      {showOfflineModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="card max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">오프라인 계정 추가</h3>
            <p className="text-sm text-gray-400 mb-4">
              오프라인 계정은 싱글플레이 또는 크랙 서버에서만 사용할 수 있습니다.
            </p>
            <input
              type="text"
              value={offlineUsername}
              onChange={(e) => setOfflineUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddOffline()}
              placeholder="사용자 이름"
              className="input mb-4"
              maxLength={16}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowOfflineModal(false);
                  setOfflineUsername('');
                }}
                className="btn-secondary"
                disabled={loading}
              >
                취소
              </button>
              <button
                onClick={handleAddOffline}
                className="btn-primary"
                disabled={loading || !offlineUsername.trim()}
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
