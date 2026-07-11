import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { isHyeniPackBusy } from '../../utils/hyeniPackBusy';

interface PackSuggest {
  packId: string;
  name: string;
  version?: string | null;
  mcVersion?: string | null;
  loaderType?: string | null;
}

/**
 * 딥링크(hyenimc://auth?...&hyenipack=)로 온 혜니팩 설치 제안 — 확인 전용.
 * '설치'를 누르면 프로필 목록으로 이동하며 CreateProfileModal(혜니팩 탭)이 자동으로 열려
 * 온라인 설치 흐름을 그대로 재사용한다(설치 로직은 HyeniPackImportTab이 담당).
 */
export function HyeniPackSuggestDialog() {
  const toast = useToast();
  const navigate = useNavigate();
  const [suggest, setSuggest] = useState<PackSuggest | null>(null);

  useEffect(() => {
    const off1 = window.electronAPI.on('hyeni:pack-suggest', (raw: unknown) => {
      // 설치가 진행 중이면 새 제안을 무시(B-5) — 진행 중 흐름을 방해하지 않는다.
      if (isHyeniPackBusy()) {
        toast.info('혜니팩', '설치가 진행 중이라 새 혜니팩 제안을 무시했습니다.');
        return;
      }
      setSuggest(raw as PackSuggest);
    });
    const off2 = window.electronAPI.on('hyeni:pack-exists', (raw: unknown) => {
      const d = raw as { profileName?: string };
      toast.info('혜니팩', `이미 '${d?.profileName ?? ''}' 프로필에 설치되어 있어요. 프로필에서 업데이트를 확인하세요.`);
    });
    return () => { off1?.(); off2?.(); };
  }, [toast]);

  const handleInstall = () => {
    if (!suggest) return;
    // 프로필 목록으로 이동 + CreateProfileModal(혜니팩 탭, 해당 팩 자동 선택)
    navigate('/', { state: { hyeniPackId: suggest.packId } });
    setSuggest(null);
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
          <button type="button" onClick={() => setSuggest(null)}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            나중에
          </button>
          <button type="button" onClick={handleInstall}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-white transition-colors flex items-center gap-2">
            설치
          </button>
        </div>
      </div>
    </div>
  );
}
