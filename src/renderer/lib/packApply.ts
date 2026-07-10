/**
 * 혜니팩 적용 오케스트레이션 유틸.
 *
 * 워커 다운로드(진행 이벤트)와 파일 import(진행 이벤트)를 재사용 가능한 단위로 추출한다.
 * HyeniPackImportTab(프로필 추가)과 HyeniPackSection(프로필 개요 업데이트)이 공유한다.
 *
 * temp 파일 정리(removeTempFile)는 호출측(탭/섹션)의 finally에서 수행한다 —
 * 다운로드/설치 실패와 무관하게 정리해야 하므로 오케스트레이션 밖에 둔다.
 */
import { setHyeniPackBusy } from '../utils/hyeniPackBusy';

/** 모드 설치 진행률(hyenipack:import-progress 정규화). */
export interface ImportProgress {
  completed: number;
  total: number;
  percent: number;
  stage: string;
}

/**
 * 워커에서 팩 최신 버전을 프로필 독립 temp로 다운로드.
 * `hyenipack:download-progress`를 packId로 필터해 `onPct(0~100)`로 보고한다.
 * 반환값의 path를 이후 preview/import에 사용하고, 정리는 호출측이 담당한다.
 * 구독은 finally에서 반드시 해제한다.
 */
export async function downloadPack(
  packId: string,
  onPct: (pct: number) => void,
): Promise<{ path: string; version: string }> {
  let unlisten: (() => void) | undefined;
  try {
    onPct(0);
    unlisten = window.electronAPI.on('hyenipack:download-progress', (raw: unknown) => {
      const d = raw as { packId?: string; percent?: number };
      if (d?.packId && d.packId !== packId) return;
      onPct(d?.percent ?? 0);
    });
    return await window.electronAPI.hyenipack.downloadFromWorker(packId);
  } finally {
    unlisten?.();
  }
}

/**
 * 팩 파일(.hyenipack)을 프로필에 설치(import).
 * - busy 플래그(B-5)를 세팅해 설치 중 딥링크 제안이 무시되게 한다(탭·섹션 공통 커버).
 * - `hyenipack:import-progress`를 profileId로 필터해 `onProgress`로 보고한다.
 * - import 실패 시 throw(호출측이 errorText로 표시).
 * - 구독 해제 + busy 해제는 finally.
 */
export async function applyPackFile(opts: {
  profileId: string;
  filePath: string;
  accountId?: string;
  onProgress: (p: ImportProgress) => void;
}): Promise<void> {
  const { profileId, filePath, accountId, onProgress } = opts;
  let unlisten: (() => void) | undefined;
  setHyeniPackBusy(true);
  try {
    unlisten = window.electronAPI.on('hyenipack:import-progress', (raw: unknown) => {
      const data = raw as {
        profileId?: string;
        completed?: number;
        total?: number;
        percent?: number;
        stage?: string;
      };
      if (data?.profileId && data.profileId !== profileId) return;
      onProgress({
        completed: data?.completed ?? 0,
        total: data?.total ?? 0,
        percent: data?.percent ?? 0,
        stage: data?.stage ?? 'mods',
      });
    });
    const result = await window.electronAPI.hyenipack.import(filePath, profileId, accountId);
    if (!result.success) {
      throw new Error(result.error || '혜니팩 설치에 실패했습니다.');
    }
  } finally {
    unlisten?.();
    setHyeniPackBusy(false);
  }
}
