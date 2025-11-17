import React, { useState, useEffect } from 'react';
import { Upload, FileArchive, Loader2, CheckCircle2, XCircle, Package, Cpu, HardDrive, AlertTriangle, X } from 'lucide-react';

interface ImportModpackTabProps {
  onSuccess: () => void;
  onImportingChange?: (importing: boolean) => void;
  onProfileIdChange?: (profileId: string | null) => void;
}

interface ModpackMetadata {
  name: string;
  version?: string;
  author?: string;
  gameVersion: string;
  loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';
  loaderVersion?: string;
  modCount?: number;
  fileSize: number;
}

interface FailedMod {
  fileName: string;
  reason: string;
  category: 'api_error' | 'download_failed' | 'checksum_mismatch' | 'not_found' | 'timeout';
  retryable: boolean;
  attempts: number;
  lastError?: string;
}

interface ImportResult {
  success: boolean;
  expectedMods: number;
  installedMods: number;
  failedMods: FailedMod[];
  partialSuccess: boolean;
  warning?: string;
  error?: string;
}

export function ImportModpackTab({ onSuccess, onImportingChange, onProfileIdChange }: ImportModpackTabProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ModpackMetadata | null>(null);
  const [profileName, setProfileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [showFailedMods, setShowFailedMods] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getLoaderDisplayName = (type: string) => {
    const names: Record<string, string> = {
      vanilla: 'Vanilla',
      fabric: 'Fabric',
      forge: 'Forge',
      neoforge: 'NeoForge',
      quilt: 'Quilt',
    };
    return names[type] || type;
  };

  const handleSelectFile = async () => {
    try {
      setError(null);
      const filePath = await window.electronAPI.modpack.selectFile();
      
      if (!filePath) return;

      setValidating(true);
      setSelectedFile(filePath);

      // 파일 검증
      const fileInfo = await window.electronAPI.modpack.validateFile(filePath);
      
      if (!fileInfo.valid) {
        setError(fileInfo.errors?.join(', ') || '유효하지 않은 모드팩 파일입니다');
        setSelectedFile(null);
        setValidating(false);
        return;
      }

      // 메타데이터 추출
      const meta = await window.electronAPI.modpack.extractMetadata(filePath);
      setMetadata(meta);
      setProfileName(meta.name || '');
      setValidating(false);
    } catch (err) {
      console.error('Failed to validate modpack:', err);
      setError(err instanceof Error ? err.message : '파일 처리 중 오류가 발생했습니다');
      setSelectedFile(null);
      setMetadata(null);
      setValidating(false);
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    setError(null);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    if (!file.name.endsWith('.zip') && !file.name.endsWith('.mrpack') && !file.name.endsWith('.hyenipack')) {
      setError('지원하지 않는 파일 형식입니다. .hyenipack, .zip 또는 .mrpack 파일을 선택해주세요.');
      return;
    }

    try {
      setValidating(true);
      setSelectedFile(file.path);

      // 파일 검증
      const fileInfo = await window.electronAPI.modpack.validateFile(file.path);
      
      if (!fileInfo.valid) {
        setError(fileInfo.errors?.join(', ') || '유효하지 않은 모드팩 파일입니다');
        setSelectedFile(null);
        setValidating(false);
        return;
      }

      // 메타데이터 추출
      const meta = await window.electronAPI.modpack.extractMetadata(file.path);
      setMetadata(meta);
      setProfileName(meta.name || '');
      setValidating(false);
    } catch (err) {
      console.error('Failed to validate modpack:', err);
      setError(err instanceof Error ? err.message : '파일 처리 중 오류가 발생했습니다');
      setSelectedFile(null);
      setMetadata(null);
      setValidating(false);
    }
  };

  const handleCancel = async () => {
    if (!currentProfileId) return;
    
    if (confirm('설치를 취소하시겠습니까? 진행 중인 다운로드가 중단됩니다.')) {
      try {
        await window.electronAPI.modpack.cancelInstall(currentProfileId);
        console.log('[ImportModpackTab] Installation cancelled');
        
        setImporting(false);
        onImportingChange?.(false);
        onProfileIdChange?.(null);
        setCurrentProfileId(null);
        setProgress(null);
        setSelectedFile(null);
        setMetadata(null);
        setProfileName('');
        setError('사용자가 설치를 취소했습니다');
      } catch (err) {
        console.error('Failed to cancel installation:', err);
        setError('취소 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
      }
    }
  };

  const handleImport = async () => {
    if (!selectedFile || !profileName.trim() || !metadata) {
      setError('프로필 이름을 입력해주세요');
      return;
    }

    try {
      setImporting(true);
      onImportingChange?.(true);
      setError(null);
      setImportResult(null);

      // 1. Create profile first
      const profileData = {
        name: profileName.trim(),
        description: `${metadata.name}에서 가져온 모드팩`,
        gameVersion: metadata.gameVersion,
        loaderType: metadata.loaderType,
        loaderVersion: metadata.loaderVersion || '',
        icon: '📦',
      };

      console.log('[ImportModpackTab] Creating profile:', profileData);
      const profile = await window.electronAPI.profile.create(profileData);
      console.log('Created profile:', profile);
      
      // 프로필 ID 저장 (취소용)
      setCurrentProfileId(profile.id);
      onProfileIdChange?.(profile.id);

      // 2. Listen for progress
      const cleanupProgress = window.electronAPI.on('modpack:import-progress', (data: any) => {
        setProgress(data);
      });

      // 3. Import modpack into profile
      const result = await window.electronAPI.modpack.importFile(selectedFile, profile.id);
      
      // 4. 결과 처리
      if (result?.result) {
        setImportResult(result.result);
        
        if (result.result.partialSuccess) {
          // 부분 성공 - 경고 표시
          setError(`경고: ${result.result.failedMods.length}개 모드 설치 실패 (${result.result.installedMods}/${result.result.expectedMods} 설치 완료)`);
        } else if (!result.result.success) {
          // 완전 실패
          throw new Error(result.result.error || '모드팩 가져오기에 실패했습니다');
        }
      }

      cleanupProgress();
      setImporting(false);
      onImportingChange?.(false);
      onProfileIdChange?.(null);
      setCurrentProfileId(null);
      
      // 성공 또는 부분 성공시 성공 핸들러 호출
      if (!result?.result || result.result.success || result.result.partialSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Failed to import modpack:', err);
      setError(err instanceof Error ? err.message : '모드팩 가져오기에 실패했습니다');
      setImporting(false);
      onImportingChange?.(false);
      onProfileIdChange?.(null);
      setCurrentProfileId(null);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* File Selection Area */}
      {!selectedFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleFileDrop}
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
            dragActive
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-gray-700 hover:border-gray-600'
          }`}
        >
          <div className="flex flex-col items-center gap-4">
            {validating ? (
              <>
                <Loader2 className="w-16 h-16 text-purple-500 animate-spin" />
                <div>
                  <p className="text-lg font-semibold text-gray-200 mb-1">파일 검증 중...</p>
                  <p className="text-sm text-gray-400">잠시만 기다려주세요</p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-gray-800 p-6 rounded-full">
                  <Upload className="w-12 h-12 text-gray-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-200 mb-2">
                    모드팩 파일을 드래그하거나 선택하세요
                  </p>
                  <p className="text-sm text-gray-400 mb-4">
                    .hyenipack, .mrpack, .zip 파일 지원
                  </p>
                  <button
                    type="button"
                    onClick={handleSelectFile}
                    className="btn-primary px-6 py-3 font-semibold inline-flex items-center gap-2 mx-auto"
                  >
                    <FileArchive className="w-5 h-5" />
                    파일 선택
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-4">
                  <p className="font-semibold mb-1">지원하는 형식:</p>
                  <p>혜니팩 (.hyenipack), Modrinth (.mrpack), CurseForge (.zip), MultiMC/Prism (.zip), ATLauncher (.zip)</p>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Metadata Preview */
        <div className="space-y-4">
          {/* File Info Card */}
          <div className="card bg-gradient-to-br from-purple-900/20 to-pink-900/20 border-purple-500/30">
            <div className="flex items-start gap-4">
              <div className="bg-purple-500/20 p-4 rounded-xl">
                <Package className="w-8 h-8 text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-100 mb-2">{metadata?.name}</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-gray-300">
                    <Cpu className="w-4 h-4 text-gray-400" />
                    <span>
                      <strong>버전:</strong> {metadata?.gameVersion}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-300">
                    <Package className="w-4 h-4 text-gray-400" />
                    <span>
                      <strong>로더:</strong> {metadata && getLoaderDisplayName(metadata.loaderType)}
                      {metadata?.loaderVersion && ` ${metadata.loaderVersion}`}
                    </span>
                  </div>
                  {metadata?.modCount !== undefined && metadata.modCount > 0 && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Package className="w-4 h-4 text-gray-400" />
                      <span>
                        <strong>모드:</strong> {metadata.modCount}개
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-300">
                    <HardDrive className="w-4 h-4 text-gray-400" />
                    <span>
                      <strong>크기:</strong> {metadata && formatFileSize(metadata.fileSize)}
                    </span>
                  </div>
                  {metadata?.author && (
                    <div className="col-span-2 flex items-center gap-2 text-gray-300">
                      <span>
                        <strong>제작자:</strong> {metadata.author}
                      </span>
                    </div>
                  )}
                  {metadata?.version && (
                    <div className="col-span-2 flex items-center gap-2 text-gray-300">
                      <span>
                        <strong>모드팩 버전:</strong> {metadata.version}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setMetadata(null);
                  setProfileName('');
                  setError(null);
                }}
                className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-lg transition-colors"
                disabled={importing}
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Profile Name Input */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-300">
              프로필 이름 <span className="text-pink-400">*</span>
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="input text-base"
              placeholder="프로필 이름을 입력하세요"
              required
              disabled={importing}
            />
            <p className="text-xs text-gray-500 mt-1">
              비워두면 모드팩 이름이 사용됩니다
            </p>
          </div>

          {/* Progress */}
          {importing && progress && (
            <div className="card bg-gray-900/50 border-purple-500/30">
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-300 font-medium">{progress.message}</span>
                  <span className="text-purple-400 font-bold">{progress.progress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              </div>
              
              {/* 상세 정보 */}
              {(progress.installedMods !== undefined || progress.failedMods !== undefined) && (
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-gray-300">
                      성공: <strong className="text-green-400">{progress.installedMods || 0}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-gray-300">
                      실패: <strong className="text-red-400">{progress.failedMods || 0}</strong>
                    </span>
                  </div>
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>모드팩을 가져오는 중입니다...</span>
                </div>
                
                {/* 취소 버튼 */}
                <button
                  onClick={handleCancel}
                  className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-red-500/20 hover:border-red-500/30"
                >
                  <X className="w-3.5 h-3.5" />
                  취소
                </button>
              </div>
            </div>
          )}

          {/* Import Button */}
          {!importing && (
            <button
              onClick={handleImport}
              disabled={!profileName.trim()}
              className="btn-primary w-full py-3 text-base font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              모드팩 가져오기
            </button>
          )}
        </div>
      )}

      {/* Error/Warning Message */}
      {error && (
        <div className={`p-4 border rounded-lg text-sm ${
          importResult?.partialSuccess 
            ? 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300' 
            : 'bg-red-900/20 border-red-500/30 text-red-300'
        }`}>
          <div className="flex items-start gap-2">
            {importResult?.partialSuccess ? (
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-semibold mb-1">
                {importResult?.partialSuccess ? '경고' : '오류'}
              </p>
              <p>{error}</p>
              
              {importResult?.partialSuccess && (
                <button
                  onClick={() => setShowFailedMods(!showFailedMods)}
                  className="mt-2 text-xs underline hover:text-yellow-200"
                >
                  {showFailedMods ? '실패 목록 숨기기' : '실패 목록 보기'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* 실패한 모드 리스트 */}
      {showFailedMods && importResult?.failedMods && importResult.failedMods.length > 0 && (
        <div className="card bg-gray-900/50 border-red-500/30">
          <h4 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-400" />
            설치 실패한 모드 ({importResult.failedMods.length}개)
          </h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {importResult.failedMods.map((mod, idx) => (
              <div key={idx} className="p-3 bg-gray-800/50 rounded border border-gray-700 text-xs">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono text-gray-300 break-all">{mod.fileName}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${
                    mod.category === 'api_error' ? 'bg-orange-500/20 text-orange-300' :
                    mod.category === 'download_failed' ? 'bg-red-500/20 text-red-300' :
                    mod.category === 'checksum_mismatch' ? 'bg-purple-500/20 text-purple-300' :
                    mod.category === 'not_found' ? 'bg-gray-500/20 text-gray-300' :
                    'bg-yellow-500/20 text-yellow-300'
                  }`}>
                    {mod.category === 'api_error' ? 'API' :
                     mod.category === 'download_failed' ? '다운로드' :
                     mod.category === 'checksum_mismatch' ? '체크섬' :
                     mod.category === 'not_found' ? '누락' :
                     '타임아웃'}
                  </span>
                </div>
                <p className="text-gray-400 mb-1">{mod.reason}</p>
                <div className="flex items-center gap-3 text-gray-500">
                  <span>시도: {mod.attempts}회</span>
                  {mod.lastError && (
                    <span className="text-xs truncate" title={mod.lastError}>
                      {mod.lastError}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
