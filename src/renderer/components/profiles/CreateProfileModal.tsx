import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface CreateProfileModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface JavaInstallation {
  path: string;
  version: string;
  majorVersion: number;
  vendor?: string;
  architecture: string;
}

export function CreateProfileModal({ onClose, onSuccess }: CreateProfileModalProps) {
  const [versions, setVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [loadingJava, setLoadingJava] = useState(true);
  const [recommendedJava, setRecommendedJava] = useState<number>(17);
  const [formData, setFormData] = useState<any>({
    name: '',
    description: '',
    gameVersion: '',
    loaderType: 'vanilla',
    loaderVersion: '',
  });
  const [selectedJava, setSelectedJava] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Loader versions
  const [loaderVersions, setLoaderVersions] = useState<Array<{ version: string; stable: boolean }>>([]);
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [includeUnstableVersions, setIncludeUnstableVersions] = useState(false);

  // Load Minecraft versions on mount
  React.useEffect(() => {
    const loadVersions = async () => {
      try {
        const versionList = await window.electronAPI.version.list();
        const latest = await window.electronAPI.version.latest();
        setVersions(versionList);
        setFormData((prev: any) => ({ ...prev, gameVersion: latest }));
      } catch (err) {
        console.error('Failed to load versions:', err);
        // Fallback versions
        const fallback = [
          '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
          '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20',
          '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5',
        ];
        setVersions(fallback);
        setFormData((prev: any) => ({ ...prev, gameVersion: fallback[0] }));
      } finally {
        setLoadingVersions(false);
      }
    };
    loadVersions();
  }, []);

  // Load Java installations on mount
  React.useEffect(() => {
    const loadJava = async () => {
      try {
        const installations = await window.electronAPI.java.detect();
        setJavaInstallations(installations);
        if (installations.length > 0) {
          setSelectedJava(installations[0].path);
        }
      } catch (err) {
        console.error('Failed to detect Java:', err);
      } finally {
        setLoadingJava(false);
      }
    };
    loadJava();
  }, []);

  // Update recommended Java when version changes
  React.useEffect(() => {
    if (formData.gameVersion) {
      window.electronAPI.java.getRecommended(formData.gameVersion).then(recommended => {
        setRecommendedJava(recommended);
      });
    }
  }, [formData.gameVersion]);

  // Load loader versions when loader type, game version, or includeUnstable changes
  React.useEffect(() => {
    if (formData.loaderType !== 'vanilla' && formData.gameVersion) {
      const loadLoaderVersions = async () => {
        try {
          setLoadingLoaderVersions(true);
          const result = await window.electronAPI.loader.getVersions(
            formData.loaderType,
            formData.gameVersion,
            includeUnstableVersions
          );
          
          console.log('[UI] Loader versions result:', result);
          const versions = result.versions || [];
          console.log('[UI] Loader versions count:', versions.length);
          console.log('[UI] Include unstable:', includeUnstableVersions);
          if (versions.length > 0) {
            console.log('[UI] First version (latest):', versions[0]);
          }
          
          setLoaderVersions(versions);
          
          // Auto-select first version (최신 버전)
          if (versions.length > 0) {
            const firstVersion = versions[0];
            console.log('[UI] Auto-selecting version:', firstVersion.version);
            setFormData((prev: any) => ({ ...prev, loaderVersion: firstVersion.version }));
          } else {
            setFormData((prev: any) => ({ ...prev, loaderVersion: '' }));
          }
        } catch (err) {
          console.error('Failed to load loader versions:', err);
          setLoaderVersions([]);
        } finally {
          setLoadingLoaderVersions(false);
        }
      };
      loadLoaderVersions();
    } else {
      setLoaderVersions([]);
      setFormData((prev: any) => ({ ...prev, loaderVersion: '' }));
    }
  }, [formData.loaderType, formData.gameVersion, includeUnstableVersions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('프로필 이름을 입력해주세요.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      await window.electronAPI.profile.create(formData);
      onSuccess();
    } catch (err) {
      console.error('Failed to create profile:', err);
      setError(err instanceof Error ? err.message : '프로필 생성에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="card max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            새 프로필 만들기
          </h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-300">
              프로필 이름 <span className="text-pink-400">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="input text-base"
              placeholder="예: 혜니월드 생존"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-300">
              설명
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="input resize-none text-base"
              rows={2}
              placeholder="프로필에 대한 간단한 설명을 입력하세요"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Game Version */}
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-300">
                마인크래프트 버전 <span className="text-pink-400">*</span>
              </label>
              <select
                value={formData.gameVersion}
                onChange={(e) => handleChange('gameVersion', e.target.value)}
                className="input text-base"
                required
                disabled={loadingVersions}
              >
                {loadingVersions ? (
                  <option>버전 로딩 중...</option>
                ) : (
                  versions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Loader Type */}
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-300">
                로더 타입 <span className="text-pink-400">*</span>
              </label>
              <select
                value={formData.loaderType}
                onChange={(e) => handleChange('loaderType', e.target.value)}
                className="input text-base"
                required
              >
                <option value="vanilla">바닐라</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge (권장하지 않음)</option>
                <option value="neoforge">NeoForge ⭐</option>
              </select>
            </div>
          </div>

          {/* Forge deprecation warning */}
          {formData.loaderType === 'forge' && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
              <p className="text-sm text-yellow-300 font-semibold mb-1">
                ⚠ Forge는 권장하지 않습니다
              </p>
              <p className="text-xs text-yellow-400">
                Forge 개발이 중단되었습니다. 대신 <strong>NeoForge</strong>를 사용하시는 것을 강력히 권장합니다.
              </p>
            </div>
          )}

          {/* Loader Version */}
          {formData.loaderType !== 'vanilla' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-300">
                  {formData.loaderType === 'fabric' ? 'Fabric' : formData.loaderType === 'quilt' ? 'Quilt' : formData.loaderType === 'neoforge' ? 'NeoForge' : 'Forge'} 버전
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={includeUnstableVersions}
                    onChange={(e) => setIncludeUnstableVersions(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
                  />
                  <span>불안정 버전 포함</span>
                </label>
              </div>
              {loadingLoaderVersions ? (
                <div className="input flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  버전 로딩 중...
                </div>
              ) : loaderVersions.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={formData.loaderVersion}
                    onChange={(e) => handleChange('loaderVersion', e.target.value)}
                    className="input text-base"
                    required
                  >
                    {loaderVersions.map((loaderVer: any, index: number) => {
                      const displayText = `${loaderVer.version}${loaderVer.stable ? ' (안정)' : ''}`;
                      return (
                        <option 
                          key={`${loaderVer.version}-${index}`} 
                          value={loaderVer.version}
                          className="bg-gray-800 text-white"
                        >
                          {displayText}
                        </option>
                      );
                    })}
                  </select>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      {loaderVersions.length}개의 버전 사용 가능
                      {!includeUnstableVersions && loaderVersions.some((v: any) => !v.stable) && ' (안정 버전만)'}
                    </span>
                    {formData.loaderVersion && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        loaderVersions.find((v: any) => v.version === formData.loaderVersion)?.stable
                          ? 'bg-green-900/30 text-green-300 border border-green-800'
                          : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'
                      }`}>
                        {loaderVersions.find((v: any) => v.version === formData.loaderVersion)?.stable ? '안정' : '불안정'}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3">
                  <p className="text-sm text-yellow-300">
                    사용 가능한 로더 버전이 없습니다.
                  </p>
                  <p className="text-xs text-yellow-400 mt-1">
                    다른 Minecraft 버전을 선택하거나 바닐라를 사용하세요.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Java Selection */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-300">
              Java 버전
            </label>
            {loadingJava ? (
              <div className="input flex items-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Java 감지 중...
              </div>
            ) : javaInstallations.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedJava}
                  onChange={(e) => setSelectedJava(e.target.value)}
                  className="input text-base"
                >
                  {javaInstallations.map((java) => (
                    <option key={java.path} value={java.path}>
                      Java {java.majorVersion} ({java.version})
                      {java.vendor ? ` - ${java.vendor}` : ''}
                      {java.majorVersion >= recommendedJava && (
                        <span> ✓</span>
                      )}
                    </option>
                  ))}
                </select>
                <div className="flex items-start gap-2 text-xs">
                  {(() => {
                    const selectedJavaInstall = javaInstallations.find(j => j.path === selectedJava);
                    const isCompatible = selectedJavaInstall && selectedJavaInstall.majorVersion >= recommendedJava;
                    return (
                      <>
                        <span className={`px-2 py-1 rounded font-medium ${
                          isCompatible
                            ? 'bg-green-900/30 text-green-300 border border-green-800'
                            : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800'
                        }`}>
                          권장: Java {recommendedJava}+
                        </span>
                        {!isCompatible && selectedJavaInstall && (
                          <span className="text-yellow-400">
                            ⚠ 선택한 Java 버전이 권장 버전보다 낮습니다
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-300 font-semibold mb-1">
                  ⚠ Java를 찾을 수 없습니다
                </p>
                <p className="text-xs text-red-400">
                  Java {recommendedJava} 이상을 설치해야 게임을 실행할 수 있습니다
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-300 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 flex items-start gap-2">
              <span className="text-red-400 font-bold">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 py-3 text-base font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  생성 중...
                </>
              ) : (
                '프로필 만들기'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 btn-secondary disabled:opacity-50 py-3 text-base font-semibold"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
