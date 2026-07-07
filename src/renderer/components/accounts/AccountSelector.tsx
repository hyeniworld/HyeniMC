import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { User, Trash2, LogIn, RefreshCw } from 'lucide-react';

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
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
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
      toast.error('로그인 실패', error.message || 'Microsoft 로그인에 실패했습니다');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-300">
          <User className="inline w-4 h-4 mr-1" />
          계정 선택
        </label>
        <button
          onClick={handleMicrosoftLogin}
          disabled={loading}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1 disabled:opacity-50"
        >
          <LogIn className="w-3 h-3" />
          Microsoft 로그인
        </button>
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveAccount(account.id);
                  }}
                  className="p-1 hover:bg-red-600/20 rounded text-red-400 hover:text-red-300"
                  title="계정 삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
