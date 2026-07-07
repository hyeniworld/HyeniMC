import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { User, Trash2, LogIn, ChevronDown, RefreshCw } from 'lucide-react';

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
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
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
      toast.error('로그인 실패', error.message || 'Microsoft 로그인에 실패했습니다');
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
      toast.error('삭제 실패', error.message || '계정 삭제에 실패했습니다');
    }
  };

  const handleRefreshAccount = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    
    try {
      await window.electronAPI.account.refresh(accountId);
      await loadAccounts();
      toast.success('계정 갱신 완료', 'Microsoft에서 최신 정보를 가져왔습니다');
    } catch (error: any) {
      toast.error('갱신 실패', error.message || '계정 갱신에 실패했습니다');
    } finally {
      setLoading(false);
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
              {selectedAccount.uuid ? (
                <img
                  src={`https://crafatar.com/avatars/${selectedAccount.uuid}?size=32&overlay&t=${Math.floor(Date.now() / 3600000)}`}
                  alt={selectedAccount.name}
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
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
              {accounts.length === 0 && (
                <div className="p-4 text-center text-xs text-gray-500">
                  Microsoft 계정으로 로그인하세요
                </div>
              )}

              {/* Account List */}
              {accounts.map((account) => (
                <div
                  key={account.id}
                  onClick={() => {
                    onAccountChange(account.id);
                    setShowDropdown(false);
                  }}
                  className={`p-3 hover:bg-gray-800 cursor-pointer transition-colors ${
                    selectedAccountId === account.id ? 'bg-purple-500/10 border-l-4 border-purple-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {account.uuid ? (
                        <img
                          src={`https://crafatar.com/avatars/${account.uuid}?size=32&overlay&t=${Math.floor(Date.now() / 3600000)}`}
                          alt={account.name}
                          className="w-8 h-8 rounded"
                          onError={(e) => {
                            // Fallback to first letter if image fails to load
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div 
                        className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center text-white text-sm font-bold"
                        style={{ display: account.uuid ? 'none' : 'flex' }}
                      >
                        {account.name[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{account.name}</div>
                        <div className="text-xs text-gray-400">
                          <span className="text-blue-400">🔐 Microsoft</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {account.type === 'microsoft' && (
                        <button
                          onClick={(e) => handleRefreshAccount(account.id, e)}
                          className="p-1 hover:bg-blue-600/20 rounded text-blue-400 hover:text-blue-300"
                          title="계정 정보 갱신"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleRemoveAccount(account.id, e)}
                        className="p-1 hover:bg-red-600/20 rounded text-red-400 hover:text-red-300"
                        title="계정 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Divider */}
              <div className="border-t border-gray-700 my-1" />

              {/* Add Account Buttons */}
              <div className="p-2">
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
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
