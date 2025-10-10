import React, { useState, useEffect } from 'react';
import { User, UserPlus, Trash2, LogIn } from 'lucide-react';

interface Account {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  skin?: string;
  lastUsed?: number;
}

interface AccountSelectorProps {
  selectedAccountId?: string;
  onSelect: (accountId: string | undefined) => void;
}

export function AccountSelector({ selectedAccountId, onSelect }: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
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
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    try {
      const account = await window.electronAPI.account.loginMicrosoft();
      await loadAccounts();
      onSelect(account.id);
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
      onSelect(account.id);
      setShowOfflineModal(false);
      setOfflineUsername('');
    } catch (error: any) {
      alert(error.message || '오프라인 계정 추가에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!confirm('이 계정을 삭제하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.account.remove(accountId);
      if (selectedAccountId === accountId) {
        onSelect(undefined);
      }
      await loadAccounts();
    } catch (error: any) {
      alert(error.message || '계정 삭제에 실패했습니다');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-300">
          <User className="inline w-4 h-4 mr-1" />
          계정 선택
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleMicrosoftLogin}
            disabled={loading}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1 disabled:opacity-50"
          >
            <LogIn className="w-3 h-3" />
            Microsoft 로그인
          </button>
          <button
            onClick={() => setShowOfflineModal(true)}
            disabled={loading}
            className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded flex items-center gap-1 disabled:opacity-50"
          >
            <UserPlus className="w-3 h-3" />
            오프라인 계정
          </button>
        </div>
      </div>

      {/* Account List */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        <div
          onClick={() => onSelect(undefined)}
          className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
            !selectedAccountId
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
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

        {accounts.map((account) => (
          <div
            key={account.id}
            onClick={() => onSelect(account.id)}
            className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
              selectedAccountId === account.id
                ? 'border-purple-500 bg-purple-500/10'
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {account.uuid ? (
                  <img
                    src={`https://crafatar.com/avatars/${account.uuid}?size=32&overlay`}
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
                    {account.type === 'microsoft' ? (
                      <span className="text-blue-400">🔐 Microsoft</span>
                    ) : (
                      <span className="text-gray-500">오프라인</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveAccount(account.id);
                }}
                className="p-1 hover:bg-red-600/20 rounded text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
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
    </div>
  );
}
