import React, { useEffect, useState } from 'react';
import { Package, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { errorText } from '../../utils/errorText';

interface PackSuggest {
  packId: string;
  name: string;
  version?: string | null;
  mcVersion?: string | null;
  loaderType?: string | null;
}

/** 딥링크(hyenimc://auth?...&hyenipack=)로 온 혜니팩 설치 제안 — 확인 후 프로필 생성+설치. */
export function HyeniPackSuggestDialog() {
  const toast = useToast();
  const [suggest, setSuggest] = useState<PackSuggest | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const off1 = window.electronAPI.on('hyeni:pack-suggest', (raw: unknown) => {
      setSuggest(raw as PackSuggest);
    });
    const off2 = window.electronAPI.on('hyeni:pack-exists', (raw: unknown) => {
      const d = raw as { profileName?: string };
      toast.info('혜니팩', `이미 '${d?.profileName ?? ''}' 프로필에 설치되어 있어요. 프로필에서 업데이트를 확인하세요.`);
    });
    return () => { off1?.(); off2?.(); };
  }, []);

  const handleInstall = async () => {
    if (!suggest) return;
    setInstalling(true);
    try {
      const profile = await window.electronAPI.profile.create({
        name: suggest.name,
        gameVersion: suggest.mcVersion || '1.21.1',   // 팩 설치가 실제 값으로 덮어씀
        loaderType: suggest.loaderType || 'neoforge',
        loaderVersion: '',
      });
      const outcome = await (window.electronAPI as any).hyenipack.installFromWorker(
        profile.id, suggest.packId, undefined,
      );
      toast.success('혜니팩 설치 완료', `${suggest.name} 프로필이 생성되었습니다.`);
      if (!outcome?.tokenApplied) {
        toast.info('인증 안내', '이 서버의 디스코드 채널에서 /인증을 실행하면 서버 접속 준비가 끝납니다.');
      }
      setSuggest(null);
    } catch (e) {
      toast.error('혜니팩 설치 실패', errorText(e, '설치에 실패했습니다.'));
    } finally {
      setInstalling(false);
    }
  };

  if (!suggest) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-purple-400" />
          <h3 className="font-bold text-white">혜니팩 설치</h3>
        </div>
        <p className="text-sm text-gray-300">
          '<span className="font-semibold">{suggest.name}</span>'
          {suggest.version ? ` v${suggest.version}` : ''}을(를) 설치할까요?
          {suggest.mcVersion && (
            <span className="block text-xs text-gray-500 mt-1">
              {suggest.mcVersion} · {suggest.loaderType}
            </span>
          )}
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" disabled={installing} onClick={() => setSuggest(null)}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            나중에
          </button>
          <button type="button" disabled={installing} onClick={handleInstall}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-white transition-colors flex items-center gap-2">
            {installing && <Loader2 className="w-4 h-4 animate-spin" />} 설치
          </button>
        </div>
      </div>
    </div>
  );
}
