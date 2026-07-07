import React, { useState } from 'react';
import { FileArchive, Loader2, Package, Cpu } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { errorText } from '../../utils/errorText';
import { useAccount } from '../../App';

interface HyeniPackImportTabProps {
  onSuccess: () => void;
  onImportingChange?: (importing: boolean) => void;
}

interface PackManifest {
  name: string;
  version: string;
  minecraft: { version: string; loaderType: string; loaderVersion?: string };
  mods?: unknown[];
}

/**
 * 혜니팩(.hyenipack) 파일로 새 프로필 생성 — 사용자 런처용.
 * 파일 선택 → preview(메타) → profile.create → hyenipack.import(모드 설치).
 * (온라인 모드팩 검색/제작 흐름인 ImportModpackTab과 분리 — 사용자는 팩 파일 import만)
 */
export function HyeniPackImportTab({ onSuccess, onImportingChange }: HyeniPackImportTabProps) {
  const toast = useToast();
  const { selectedAccountId } = useAccount();
  const [filePath, setFilePath] = useState('');
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number; percent: number; stage: string } | null>(null);

  const setImportingState = (v: boolean) => {
    setImporting(v);
    onImportingChange?.(v);
  };

  const handleSelectFile = async () => {
    setError(null);
    try {
      const path = await (window.electronAPI as any).dialog.selectFile({
        filters: [{ name: 'HyeniPack', extensions: ['hyenipack'] }],
      });
      if (!path) return;
      setFilePath(path);
      const result = await window.electronAPI.hyenipack.preview(path);
      if (result.success && result.manifest) {
        setManifest(result.manifest as PackManifest);
        setName(result.manifest.name || '');
      } else {
        setError(errorText(result.error, '혜니팩을 읽을 수 없습니다.'));
        setManifest(null);
      }
    } catch (e) {
      setError(errorText(e, '파일 선택에 실패했습니다.'));
    }
  };

  const handleCreate = async () => {
    if (!manifest || !name.trim()) return;
    setImportingState(true);
    setError(null);
    setProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      // 팩 메타 기준으로 프로필 생성 후 혜니팩 import(모드 설치)
      const profile = await window.electronAPI.profile.create({
        name: name.trim(),
        gameVersion: manifest.minecraft.version,
        loaderType: manifest.minecraft.loaderType,
        loaderVersion: manifest.minecraft.loaderVersion || '',
      });
      // 이 프로필의 설치 진행률만 인라인으로 구독(전역 다운로드 모달 대신)
      unlisten = window.electronAPI.on('hyenipack:import-progress', (raw: unknown) => {
        const data = raw as { profileId?: string; completed?: number; total?: number; percent?: number; stage?: string };
        if (data?.profileId && data.profileId !== profile.id) return;
        setProgress({
          completed: data?.completed ?? 0,
          total: data?.total ?? 0,
          percent: data?.percent ?? 0,
          stage: data?.stage ?? 'mods',
        });
      });
      const result = await window.electronAPI.hyenipack.import(
        filePath,
        profile.id,
        selectedAccountId
      );
      if (result.success) {
        toast.success('혜니팩 설치 완료', `${name} 프로필이 생성되었습니다.`);
        onSuccess();
      } else {
        setError(errorText(result.error, '혜니팩 설치에 실패했습니다.'));
      }
    } catch (e) {
      setError(errorText(e, '프로필 생성에 실패했습니다.'));
    } finally {
      unlisten?.();
      setImportingState(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleSelectFile}
        disabled={importing}
        className="w-full p-6 border-2 border-dashed border-gray-600 rounded-lg hover:border-purple-500 transition-colors flex flex-col items-center gap-2 text-gray-400 hover:text-gray-200 disabled:opacity-50"
      >
        <FileArchive className="w-8 h-8" />
        <span className="font-medium">{filePath ? '다른 혜니팩 선택' : '혜니팩(.hyenipack) 파일 선택'}</span>
        {filePath && <span className="text-xs text-gray-500 truncate max-w-full">{filePath}</span>}
      </button>

      {manifest && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-purple-400" />
            <span className="font-semibold text-gray-200">{manifest.name}</span>
            <span className="text-xs text-gray-500">v{manifest.version}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5" /> {manifest.minecraft.version} · {manifest.minecraft.loaderType}
              {manifest.minecraft.loaderVersion ? ` ${manifest.minecraft.loaderVersion}` : ''}
            </span>
            <span>🔧 모드 {manifest.mods?.length ?? 0}개</span>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-300">프로필 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-base"
              placeholder="프로필 이름"
              disabled={importing}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {manifest && !importing && (
        <button
          type="button"
          onClick={handleCreate}
          disabled={!name.trim()}
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          혜니팩으로 프로필 생성
        </button>
      )}

      {importing && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">
              {progress?.stage === 'finalize'
                ? '마무리 중...'
                : `모드 다운로드 중${progress?.total ? ` (${progress.completed}/${progress.total})` : '...'}`}
            </span>
            <span className="font-semibold text-purple-400">{Math.round(progress?.percent ?? 0)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${Math.min(100, progress?.percent ?? 0)}%` }}
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin" /> 혜니팩을 가져오는 중입니다...
          </div>
        </div>
      )}
    </div>
  );
}
