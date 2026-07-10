import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ImportProgress } from '../../lib/packApply';

interface PackApplyProgressProps {
  /** 다운로드 단계 진행률(null=다운로드 아님). null이 아니면 다운로드 라벨/퍼센트 우선. */
  downloadPct: number | null;
  /** 모드 설치 진행률(null=미시작). */
  progress: ImportProgress | null;
}

/**
 * 혜니팩 적용 진행 표시 — presentational.
 *
 * 다운로드 단계(downloadPct)와 모드 설치 단계(progress)가 공존한다.
 * HyeniPackImportTab(프로필 추가)과 HyeniPackSection(개요 업데이트)이 공유한다.
 */
export function PackApplyProgress({ downloadPct, progress }: PackApplyProgressProps) {
  const isDownloadPhase = downloadPct !== null;
  const activePct = isDownloadPhase ? downloadPct : (progress?.percent ?? 0);
  const progressLabel = isDownloadPhase
    ? '혜니팩 다운로드 중'
    : progress?.stage === 'finalize'
      ? '마무리 중...'
      : `모드 다운로드 중${progress?.total ? ` (${progress.completed}/${progress.total})` : '...'}`;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{progressLabel}</span>
        <span className="font-semibold text-purple-400">{Math.round(activePct)}%</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
          style={{ width: `${Math.min(100, activePct)}%` }}
        />
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Loader2 className="w-3 h-3 animate-spin" /> 혜니팩을 가져오는 중입니다...
      </div>
    </div>
  );
}
