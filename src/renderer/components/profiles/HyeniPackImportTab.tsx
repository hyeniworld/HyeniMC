import React, { useState, useEffect } from 'react';
import { FileArchive, Loader2, Package, Cpu } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { errorText } from '../../utils/errorText';
import { useAccount } from '../../App';
import { downloadPack, applyPackFile, type ImportProgress } from '../../lib/packApply';
import { PackApplyProgress } from '../hyeni/PackApplyProgress';

interface HyeniPackImportTabProps {
  onSuccess: () => void;
  onImportingChange?: (importing: boolean) => void;
  /** 딥링크/제안에서 넘어온 자동 선택 대상 팩 id (목록 로드 완료 시 자동 선택). */
  initialPackId?: string;
}

interface PackManifest {
  name: string;
  version: string;
  minecraft: { version: string; loaderType: string; loaderVersion?: string };
  mods?: unknown[];
}

interface OnlinePack {
  id: string;
  name: string;
  latestVersion?: string | null;
  breaking?: boolean;
  minecraft?: { version: string; loaderType: string; loaderVersion?: string } | null;
}

/**
 * 혜니팩(.hyenipack) 온라인 설치/파일 import — 사용자 런처용.
 *
 * 온라인 흐름(통일): 검색 → 리스트 선택(이름 입력) → 설치
 *   → 워커에서 .hyenipack 다운로드(진행바) → preview(실물 매니페스트)
 *   → profile.create → 기존 import 재사용(모드 설치 진행바)
 *   → applyMatchingToken → temp 정리 → onSuccess
 * 파일 흐름: 파일 선택 → preview → profile.create → import (기존 유지)
 */
export function HyeniPackImportTab({ onSuccess, onImportingChange, initialPackId }: HyeniPackImportTabProps) {
  const toast = useToast();
  const { selectedAccountId } = useAccount();
  const [filePath, setFilePath] = useState('');
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null); // 다운로드 단계 진행률(null=미진행)
  const [onlinePacks, setOnlinePacks] = useState<OnlinePack[] | null>(null); // null=로딩/실패
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedPack, setSelectedPack] = useState<OnlinePack | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setOnlinePacks(await window.electronAPI.hyenipack.listAvailable());
      } catch (e) {
        setOnlineError(errorText(e, '팩 목록을 불러올 수 없습니다.'));
        setOnlinePacks([]);
      }
    })();
  }, []);

  // 딥링크/제안으로 넘어온 initialPackId 자동 선택(목록 로드 완료 후 1회).
  useEffect(() => {
    if (!initialPackId || onlinePacks === null) return;
    const found = onlinePacks.find((p) => p.id === initialPackId);
    if (found) {
      setSelectedPack(found);
      setManifest(null);
      setName(found.name);
    } else {
      setOnlineError('팩을 찾을 수 없습니다.');
    }
  }, [initialPackId, onlinePacks]);

  const filteredPacks = (onlinePacks ?? []).filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });

  const setImportingState = (v: boolean) => {
    // busy 플래그(B-5)는 applyPackFile 유틸이 설치 구간에서 세팅한다(탭·섹션 공통). 여기서는 중복 세팅하지 않는다.
    setImporting(v);
    onImportingChange?.(v);
  };

  const handleInstallOnline = async () => {
    if (!selectedPack || !name.trim()) return;
    setImportingState(true);
    setError(null);
    setProgress(null);
    setDownloadPct(null);
    let downloadedPath: string | undefined;
    try {
      const hasToken = await window.electronAPI.hyenipack.hasAnyToken();
      if (!hasToken) {
        // 프로필/다운로드를 시작하기 전에 중단 — 잔존물 방지
        setError('팩 다운로드를 위한 인증이 필요합니다. Discord에서 /인증 명령어로 인증한 뒤 다시 시도하세요.');
        return;
      }

      // 1) 워커에서 .hyenipack 다운로드 (진행 이벤트 구독은 유틸 내부)
      const dl = await downloadPack(selectedPack.id, setDownloadPct);
      downloadedPath = dl.path;
      setDownloadPct(null);

      // 2) 실물 매니페스트로 프로필 생성 (팩 목록 메타가 아닌 다운로드된 파일 기준)
      const pv = await window.electronAPI.hyenipack.preview(downloadedPath);
      if (!pv.success || !pv.manifest) {
        setError(errorText(pv.error, '혜니팩을 읽을 수 없습니다.'));
        return;
      }
      const mc = (pv.manifest as PackManifest).minecraft;
      const profile = await window.electronAPI.profile.create({
        name: name.trim(),
        gameVersion: mc.version,
        loaderType: mc.loaderType,
        loaderVersion: mc.loaderVersion || '',
      });

      // 3) 기존 import 흐름 재사용 (모드 설치 진행 — profileId 필터, busy 세팅은 유틸 내부)
      await applyPackFile({
        profileId: profile.id,
        filePath: downloadedPath,
        accountId: selectedAccountId,
        onProgress: setProgress,
      });

      // 4) 서버 토큰 자동 적용 — 기록 실패(예외 포함)는 설치 성공을 막지 않고 /인증 안내로 강등
      let applied = false;
      try {
        applied = await window.electronAPI.hyenipack.applyMatchingToken(profile.id);
      } catch { /* 조회/기록 실패 → 아래 안내 토스트로 처리 */ }
      toast.success('혜니팩 설치 완료', `${name} 프로필이 생성되었습니다.`);
      if (!applied) {
        toast.info('인증 안내', '이 서버의 디스코드 채널에서 /인증을 실행하면 서버 접속 준비가 끝납니다.');
      }
      onSuccess();
    } catch (e) {
      setError(errorText(e, '혜니팩 설치에 실패했습니다.'));
    } finally {
      if (downloadedPath) {
        // temp 정리 실패는 무시(다음 실행/정리에서 처리)
        try { await window.electronAPI.hyenipack.removeTempFile(downloadedPath); } catch { /* noop */ }
      }
      setImportingState(false);
      setDownloadPct(null);
      setProgress(null);
    }
  };

  const handleSelectFile = async () => {
    setError(null);
    setSelectedPack(null);
    try {
      const path = await window.electronAPI.dialog.selectFile({
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
    try {
      // 팩 메타 기준으로 프로필 생성 후 혜니팩 import(모드 설치)
      const profile = await window.electronAPI.profile.create({
        name: name.trim(),
        gameVersion: manifest.minecraft.version,
        loaderType: manifest.minecraft.loaderType,
        loaderVersion: manifest.minecraft.loaderVersion || '',
      });
      // 이 프로필의 설치 진행률만 인라인으로 구독(전역 다운로드 모달 대신) — 유틸 재사용
      await applyPackFile({
        profileId: profile.id,
        filePath,
        accountId: selectedAccountId,
        onProgress: setProgress,
      });
      toast.success('혜니팩 설치 완료', `${name} 프로필이 생성되었습니다.`);
      onSuccess();
    } catch (e) {
      setError(errorText(e, '프로필 생성에 실패했습니다.'));
    } finally {
      setImportingState(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="혜니팩 검색 (이름 또는 ID)"
          className="input text-sm"
          disabled={importing}
        />
        {onlineError && <div className="text-xs text-gray-500">{onlineError}</div>}
        {onlinePacks === null && !onlineError && (
          <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> 목록 불러오는 중...</div>
        )}
        {filteredPacks.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto transition-all duration-300">
            {filteredPacks.map((p) => {
              const isSelected = selectedPack?.id === p.id;
              // 설치 중에는 선택 항목만 남기고 나머지는 부드럽게 접힘(요소는 유지).
              const collapsed = importing && !isSelected;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={importing}
                  onClick={() => { setSelectedPack(p); setManifest(null); setName(p.name); }}
                  className={`w-full text-left rounded-lg overflow-hidden px-3 transition-all duration-300 ${
                    collapsed
                      ? 'max-h-0 opacity-0 py-0 border-0'
                      : 'max-h-24 opacity-100 py-3 border ' +
                        (isSelected
                          ? 'bg-purple-500/10 border-purple-500/40'
                          : 'bg-gray-800/40 border-gray-700 hover:border-gray-500')
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-purple-400" />
                    <span className="font-medium text-gray-200">{p.name}</span>
                    <span className="text-xs text-gray-500">v{p.latestVersion ?? '?'}</span>
                  </div>
                  {p.minecraft && (
                    <div className="text-xs text-gray-500 mt-1">
                      {p.minecraft.version} · {p.minecraft.loaderType}{p.minecraft.loaderVersion ? ` ${p.minecraft.loaderVersion}` : ''}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {onlinePacks !== null && filteredPacks.length === 0 && !onlineError && (
          <div className="text-xs text-gray-500">{query ? '검색 결과가 없습니다.' : '설치 가능한 혜니팩이 없습니다.'}</div>
        )}
      </div>

      {/* 이름 입력 + 설치 버튼 — 설치 시작 시 부드럽게 접힘(언마운트 대신 collapse) */}
      {selectedPack && (
        <div className={`overflow-hidden transition-all duration-300 ${importing ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'}`}>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1 text-gray-300">프로필 이름</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="input text-base" placeholder="프로필 이름" disabled={importing} />
            </div>
            <button type="button" onClick={handleInstallOnline} disabled={!name.trim() || importing}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-white disabled:opacity-50 transition-colors">
              혜니팩 설치
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500 text-center">— 또는 파일에서 —</div>

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

      {importing && <PackApplyProgress downloadPct={downloadPct} progress={progress} />}
    </div>
  );
}
