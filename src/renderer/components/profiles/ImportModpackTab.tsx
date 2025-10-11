import React, { useState } from 'react';
import { Upload, FileArchive, Loader2, CheckCircle2, XCircle, Package, Cpu, HardDrive } from 'lucide-react';

interface ImportModpackTabProps {
  onSuccess: () => void;
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

export function ImportModpackTab({ onSuccess }: ImportModpackTabProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ModpackMetadata | null>(null);
  const [profileName, setProfileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);

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

    if (!file.name.endsWith('.zip') && !file.name.endsWith('.mrpack')) {
      setError('지원하지 않는 파일 형식입니다. .zip 또는 .mrpack 파일을 선택해주세요.');
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

  const handleImport = async () => {
    if (!selectedFile || !profileName.trim() || !metadata) {
      setError('프로필 이름을 입력해주세요');
      return;
    }

    try {
      setImporting(true);
      setError(null);

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
      console.log('[ImportModpackTab] Profile created:', profile);

      // 2. Listen for progress
      const cleanupProgress = window.electronAPI.on('modpack:import-progress', (data: any) => {
        setProgress(data);
      });

      // 3. Import modpack into profile (instanceDir is computed on main by profileId)
      await window.electronAPI.modpack.importFile(selectedFile, profile.id);

      cleanupProgress();
      onSuccess();
    } catch (err) {
      console.error('Failed to import modpack:', err);
      setError(err instanceof Error ? err.message : '모드팩 가져오기에 실패했습니다');
      setImporting(false);
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
                    .mrpack, .zip 파일 지원
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
                  <p>Modrinth (.mrpack), CurseForge (.zip), MultiMC/Prism (.zip), ATLauncher (.zip)</p>
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
              <div className="mb-3">
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
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>모드팩을 가져오는 중입니다...</span>
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

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-lg text-red-300 text-sm">
          <div className="flex items-start gap-2">
            <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">오류</p>
              <p>{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
