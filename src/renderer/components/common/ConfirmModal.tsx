import React from 'react';
import { createPortal } from 'react-dom';

/**
 * 커스텀 확인 다이얼로그 — Tauri WKWebView에서 window.confirm이 무반응이라
 * 삭제/중단 등 확인이 필요한 곳에서 네이티브 confirm 대신 사용한다.
 *
 * document.body로 포털 렌더 — 헤더 등 backdrop-filter/transform 조상 안에서 호출돼도
 * position:fixed가 그 조상 기준으로 갇히지 않고 뷰포트 중앙에 뜬다.
 */
interface ConfirmModalProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100]"
      onClick={onCancel}
    >
      <div
        className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4 border border-gray-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-2 text-gray-100">{title}</h3>
        {message && <p className="text-sm text-gray-400 mb-4">{message}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600 text-gray-200">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
