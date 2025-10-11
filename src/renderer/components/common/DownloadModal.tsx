import React from 'react';
import { useDownloadStore } from '../../store/downloadStore';

export const DownloadModal: React.FC = () => {
  const { visible, phase, percent, message, speed, currentFile } = useDownloadStore();

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-gray-800 bg-gray-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold">다운로드/설치 진행 중</h3>
          <p className="text-sm text-gray-400 mt-1">{message || phase}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="w-full bg-gray-800 rounded h-3 overflow-hidden">
            <div
              className="h-3 bg-gradient-to-r from-purple-500 to-pink-500"
              style={{ width: `${Math.min(100, Math.max(0, percent || 0))}%` }}
            />
          </div>
          <div className="text-sm text-gray-300 flex items-center justify-between">
            <span>{percent?.toFixed ? percent.toFixed(1) : percent}%</span>
            <span className="text-gray-400">{speed || ''}</span>
          </div>
          {currentFile && (
            <div className="text-xs text-gray-400 break-all">{currentFile}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
          {/* 확장: 취소/일시정지 버튼 */}
          <button
            className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
            onClick={() => { /* 옵션: 사용자가 수동으로 숨김 */ }}
          >
            숨기기
          </button>
        </div>
      </div>
    </div>
  );
};
