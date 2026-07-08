import React, { useState } from 'react';
import { X, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight } from 'lucide-react';

export interface ErrorDialogProps {
  type: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  details?: string;
  suggestions?: string[];
  actions?: ErrorAction[];
  onClose: () => void;
}

export interface ErrorAction {
  label: string;
  type: 'primary' | 'secondary' | 'danger';
  action: string;
}

export function ErrorDialog({ 
  type, 
  title, 
  message, 
  details, 
  suggestions, 
  actions,
  onClose 
}: ErrorDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  
  // 아이콘 선택
  const Icon = type === 'critical' || type === 'error' ? AlertCircle
             : type === 'warning' ? AlertTriangle
             : Info;
  
  // 색상 선택
  const iconColorClass = type === 'critical' ? 'text-red-500'
                       : type === 'error' ? 'text-red-400'
                       : type === 'warning' ? 'text-yellow-500'
                       : 'text-blue-500';
  
  const handleAction = async (action: ErrorAction) => {
    setLoading(action.label);
    try {
      if (action.action === 'openSettings') {
        // ErrorDialogProvider가 Router 바깥이라 useNavigate 불가 → HashRouter 해시로 직접 이동
        window.location.hash = '#/settings';
      } else if (action.action !== 'close') {
        // 'close'는 닫기만. 그 외(openJavaInstallGuide 등)는 어댑터의 executeAction 위임
        await window.electronAPI.errorDialog.executeAction(action.action);
      }
      onClose();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setLoading(null);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="flex items-start gap-3 p-6 border-b border-gray-700">
          <Icon className={`w-6 h-6 ${iconColorClass} flex-shrink-0 mt-1`} />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white break-words">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white flex-shrink-0 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* 본문 */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <p className="text-gray-300 whitespace-pre-wrap">{message}</p>
          
          {/* 해결 방법 */}
          {suggestions && suggestions.length > 0 && (
            <div className="bg-gray-700/50 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                💡 해결 방법:
              </h3>
              <ul className="space-y-1">
                {suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-gray-300">
                    {suggestions.length > 1 ? `${i + 1}. ` : '• '}{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* 상세 정보 (접기/펼치기) */}
          {details && (
            <div>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition"
              >
                {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                상세 정보
              </button>
              {showDetails && (
                <pre className="mt-2 p-3 bg-gray-900 rounded text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-words">
                  {details}
                </pre>
              )}
            </div>
          )}
        </div>
        
        {/* 액션 버튼 */}
        <div className="flex gap-2 justify-end p-6 border-t border-gray-700 bg-gray-800/50">
          {actions && actions.length > 0 ? (
            actions.map((action, i) => (
              <button
                key={i}
                onClick={() => handleAction(action)}
                disabled={loading !== null}
                className={`
                  px-4 py-2 rounded-lg font-medium transition flex-shrink-0
                  ${action.type === 'primary'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : action.type === 'danger'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }
                  ${loading !== null ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                {loading === action.label ? '처리 중...' : action.label}
              </button>
            ))
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-medium transition bg-gray-700 hover:bg-gray-600 text-gray-300"
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
