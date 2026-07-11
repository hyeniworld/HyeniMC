import React, { useEffect, useState } from 'react';
import { Package, FileArchive, AlertTriangle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { errorText } from '../../utils/errorText';
import { downloadPack, applyPackFile, type ImportProgress } from '../../lib/packApply';
import { PackApplyProgress } from './PackApplyProgress';

interface HyeniPackSectionProps {
  profileId: string;
  /** CF 피닝 URL 토큰 부착용 계정(없어도 동작 — 워커/저장소 토큰 폴백). */
  accountId?: string;
  /** 업데이트/적용 성공 후 페이지가 프로필을 재로드하도록 호출. */
  onUpdated: () => void;
}

interface InstalledMeta {
  hyenipackId: string;
  version: string;
}

interface PackUpdate {
  hyenipackId: string;
  currentVersion: string;
  latestVersion: string;
  breaking: boolean;
  changelog?: string | null;
}

interface PackManifest {
  hyenipackId?: string;
  name: string;
  version: string;
  minecraft: { version: string; loaderType: string; loaderVersion?: string };
  mods?: unknown[];
}

interface FilePreview {
  path: string;
  manifest: PackManifest;
}

/** dotted 숫자 버전 비교. a<b→-1, a==b→0, a>b→1. 비숫자 파트는 0 취급(KISS). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * 프로필 개요 "혜니팩" 섹션 — 온라인 업데이트 배너 + 파일 업데이트(탈출구).
 *
 * - 팩 프로필일 때만 렌더(getInstalled === null이면 null).
 * - 온라인 배너: 진입 시 1회 checkUpdate. Some이면 non-breaking/​breaking 문구로 안내.
 *   클릭 = 확인(2차 확인 없음) → 다운로드 → 설치 → 재조회(배너 소멸).
 * - 파일 업데이트: 파일 선택 → preview → 확인 카드(버전 비교/재적용/다운그레이드/​packId 불일치 경고) → 적용.
 */
export function HyeniPackSection({ profileId, accountId, onUpdated }: HyeniPackSectionProps) {
  const toast = useToast();
  const [installed, setInstalled] = useState<InstalledMeta | null | undefined>(undefined);
  const [update, setUpdate] = useState<PackUpdate | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 진입 시 1회: 설치 메타 조회 → 팩 프로필이면 업데이트 확인(실패는 조용히 무시).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = (await window.electronAPI.hyenipack.getInstalled(profileId)) as InstalledMeta | null;
        if (cancelled) return;
        setInstalled(meta);
        if (meta) {
          try {
            const u = (await window.electronAPI.hyenipack.checkUpdate(profileId)) as PackUpdate | null;
            if (!cancelled) setUpdate(u);
          } catch {
            /* 업데이트 확인 실패(Err/None) → 배너 없음 */
          }
        }
      } catch {
        if (!cancelled) setInstalled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // 성공 후 재조회: 설치 메타 + 업데이트(배너 소멸).
  const refresh = async () => {
    try {
      const meta = (await window.electronAPI.hyenipack.getInstalled(profileId)) as InstalledMeta | null;
      setInstalled(meta);
      if (meta) {
        try {
          setUpdate((await window.electronAPI.hyenipack.checkUpdate(profileId)) as PackUpdate | null);
        } catch {
          setUpdate(null);
        }
      } else {
        setUpdate(null);
      }
    } catch {
      /* 조회 실패 → 기존 상태 유지 */
    }
  };

  const handleOnlineUpdate = async () => {
    if (!installed) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    setDownloadPct(null);
    let downloadedPath: string | undefined;
    try {
      // 1) 워커에서 최신 .hyenipack 다운로드
      const dl = await downloadPack(installed.hyenipackId, setDownloadPct);
      downloadedPath = dl.path;
      setDownloadPct(null);
      // 2) 기존 import 흐름 재사용(모드 설치)
      await applyPackFile({ profileId, filePath: downloadedPath, accountId, onProgress: setProgress });
      toast.success('혜니팩 업데이트 완료', `v${dl.version}으로 업데이트되었습니다.`);
      await refresh();
      onUpdated();
    } catch (e) {
      setError(errorText(e, '혜니팩 업데이트에 실패했습니다.'));
    } finally {
      if (downloadedPath) {
        try {
          await window.electronAPI.hyenipack.removeTempFile(downloadedPath);
        } catch {
          /* temp 정리 실패 무시 */
        }
      }
      setBusy(false);
      setDownloadPct(null);
      setProgress(null);
    }
  };

  const handleSelectFile = async () => {
    setError(null);
    try {
      const path = await window.electronAPI.dialog.selectFile({
        filters: [{ name: 'HyeniPack', extensions: ['hyenipack'] }],
      });
      if (!path) return;
      const result = await window.electronAPI.hyenipack.preview(path);
      if (result.success && result.manifest) {
        setFilePreview({ path, manifest: result.manifest as PackManifest });
      } else {
        setError(errorText(result.error, '혜니팩을 읽을 수 없습니다.'));
      }
    } catch (e) {
      setError(errorText(e, '파일 선택에 실패했습니다.'));
    }
  };

  const handleApplyFile = async () => {
    if (!filePreview) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      // 사용자가 고른 로컬 파일 — temp 다운로드가 아니므로 정리하지 않는다(원본 삭제 금지).
      await applyPackFile({ profileId, filePath: filePreview.path, accountId, onProgress: setProgress });
      toast.success('혜니팩 적용 완료', `v${filePreview.manifest.version}으로 적용되었습니다.`);
      setFilePreview(null);
      await refresh();
      onUpdated();
    } catch (e) {
      setError(errorText(e, '혜니팩 적용에 실패했습니다.'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // 로딩 중/팩 프로필 아님 → 렌더 안 함.
  if (!installed) return null;

  const showBanner = update && !busy && !filePreview;

  // 파일 미리보기 버전 비교(확인 단계).
  let versionNote = '';
  let packIdMismatch = false;
  if (filePreview) {
    const cmp = compareVersions(filePreview.manifest.version, installed.version);
    versionNote = cmp === 0 ? ' (재적용)' : cmp < 0 ? ' (다운그레이드)' : '';
    packIdMismatch =
      !!filePreview.manifest.hyenipackId && filePreview.manifest.hyenipackId !== installed.hyenipackId;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 shadow border border-gray-700 space-y-4">
      {/* 헤더: 현재 팩 id·버전 + 파일 업데이트 버튼(상시) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-5 h-5 text-purple-400 shrink-0" />
          <h2 className="text-xl font-semibold text-gray-200">혜니팩</h2>
          <span className="text-sm text-gray-500 truncate">
            {installed.hyenipackId} · v{installed.version}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSelectFile}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 disabled:opacity-50 transition-colors"
        >
          <FileArchive className="w-4 h-4" /> 파일에서 업데이트
        </button>
      </div>

      {/* 온라인 배너 */}
      {showBanner && update && (
        update.breaking ? (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-red-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> 필수 업데이트 — 적용 전까지 게임 실행이 차단됩니다
              </div>
              <div className="text-xs text-gray-400 mt-1">새 버전 v{update.latestVersion}</div>
              {update.changelog && (
                <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap line-clamp-3">{update.changelog}</div>
              )}
            </div>
            <button
              type="button"
              onClick={handleOnlineUpdate}
              className="shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium text-white transition-colors"
            >
              지금 업데이트
            </button>
          </div>
        ) : (
          <div className="bg-purple-900/20 border border-purple-500/40 rounded-lg p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-purple-200">새 버전 v{update.latestVersion} 사용 가능</div>
              {update.changelog && (
                <div className="text-xs text-gray-400 mt-1 whitespace-pre-wrap line-clamp-3">{update.changelog}</div>
              )}
            </div>
            <button
              type="button"
              onClick={handleOnlineUpdate}
              className="shrink-0 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-white transition-colors"
            >
              업데이트
            </button>
          </div>
        )
      )}

      {/* 파일 미리보기 = 확인 단계 */}
      {filePreview && !busy && (
        <div className="bg-gray-900/40 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="text-sm text-gray-200">
            현재 v{installed.version} → 파일 v{filePreview.manifest.version}
            <span className="text-gray-400">{versionNote}</span>
          </div>
          {packIdMismatch && (
            <div className="text-xs text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              다른 팩입니다 — 적용 시 이 프로필의 팩이 교체됩니다
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleApplyFile}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-white transition-colors"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => setFilePreview(null)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 진행 표시(공용) */}
      {busy && <PackApplyProgress downloadPct={downloadPct} progress={progress} />}

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-300 whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  );
}
