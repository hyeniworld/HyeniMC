import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../components/common/SectionCard';
import { Slider } from '../components/common/Slider';
import { useToast } from '../contexts/ToastContext';
import { RefreshCw, Download, CheckCircle2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

type DownloadSettings = {
  request_timeout_ms?: number;
  max_retries?: number;
  max_parallel?: number;
};

type JavaSettings = {
  java_path?: string;
  memory_min?: number;
  memory_max?: number;
};

type ResolutionSettings = {
  width?: number;
  height?: number;
  fullscreen?: boolean;
};

type CacheSettings = {
  enabled?: boolean;
  max_size_gb?: number;
  ttl_days?: number;
};

type UpdateSettings = {
  check_interval_hours?: number;
  auto_download?: boolean;
};

type GlobalSettings = {
  download?: DownloadSettings;
  java?: JavaSettings;
  resolution?: ResolutionSettings;
  cache?: CacheSettings;
  update?: UpdateSettings;
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings>({});
  const [original, setOriginal] = useState<GlobalSettings>({});
  const [tab, setTab] = useState<'download'|'java'|'resolution'|'cache'|'update'|'auth'>('download');
  const [javaList, setJavaList] = useState<Array<{ path: string; version: string; majorVersion: number; vendor?: string; architecture: string }>>([]);
  const [systemMemory, setSystemMemory] = useState(16384);
  const [cacheStats, setCacheStats] = useState<{ size: number; files: number } | null>(null);
  const [cacheStatsLoading, setCacheStatsLoading] = useState(false);
  const cacheLoadedRef = useRef(false);
  const [javaLoading, setJavaLoading] = useState(false);
  const javaLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const [currentVersion, setCurrentVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'available' | 'not-available' | 'error' | null>(null);
  const [tokens, setTokens] = useState<Array<{ servers: string[]; receivedAt: number }> | null>(null);
  const [tokensError, setTokensError] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<{ receivedAt: number; label: string } | null>(null);
  const [removingToken, setRemovingToken] = useState(false);
  const s = settings;

  const loadTokens = async () => {
    try {
      const list = await window.electronAPI.hyenipack.listTokens();
      setTokens(Array.isArray(list) ? list : []);
      setTokensError(false);
    } catch {
      setTokensError(true);
    }
  };

  // 캐시 통계 측정(무거운 디스크 walk) — 언마운트 후 setState 방지(mountedRef).
  const loadCacheStats = useCallback(async () => {
    setCacheStatsLoading(true);
    try {
      const stats = await window.electronAPI.settings.getCacheStats();
      if (mountedRef.current) setCacheStats(stats);
    } catch {
      if (mountedRef.current) setCacheStats({ size: 0, files: 0 });
    } finally {
      if (mountedRef.current) setCacheStatsLoading(false);
    }
  }, []);

  // 캐시 탭을 처음 열 때만 lazy 측정. 다른 탭으로 전환해도 측정은 백그라운드로 계속되고
  // 결과는 mountedRef 가드로 안전하게 반영된다(측정 중 탭 전환 무해).
  useEffect(() => {
    if (tab === 'cache' && !cacheLoadedRef.current) {
      cacheLoadedRef.current = true;
      loadCacheStats();
    }
  }, [tab, loadCacheStats]);

  // Java 감지(~400ms, 파일시스템 스캔+java -version)를 설정 마운트에서 제거하고
  // Java 탭 첫 진입 시로 지연 — 설정 창이 즉시 뜬다. 캐시 State라 2회차부터는 즉시.
  const loadJava = useCallback(async () => {
    setJavaLoading(true);
    try {
      const list = await window.electronAPI.java.getCached();
      if (mountedRef.current) setJavaList(list || []);
    } catch {
      // 실패 시 빈 목록 유지
    } finally {
      if (mountedRef.current) setJavaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'java' && !javaLoadedRef.current) {
      javaLoadedRef.current = true;
      loadJava();
    }
  }, [tab, loadJava]);

  const handleRemoveToken = async () => {
    if (!tokenToDelete) return;
    setRemovingToken(true);
    try {
      await window.electronAPI.hyenipack.removeToken(tokenToDelete.receivedAt);
      await loadTokens();
      toast.success('인증 제거됨', '이 기기에서 인증을 제거했습니다.');
    } catch {
      toast.error('제거 실패', '인증 제거에 실패했습니다.');
    } finally {
      setRemovingToken(false);
      setTokenToDelete(null);
    }
  };

  useEffect(() => {
    // StrictMode(dev)는 mount→cleanup→mount로 이펙트를 이중 호출한다. cleanup에서 false로
    // 둔 mountedRef를 재mount 때 반드시 true로 되돌려야 한다(안 그러면 영구 false → 이후
    // 모든 비동기 setState 가드가 막혀 캐시 측정 결과가 반영 안 됨).
    mountedRef.current = true;
    (async () => {
      try {
        // Get system memory
        const sysMem = await window.electronAPI.system.getMemory?.() || 16384;
        setSystemMemory(sysMem);

        // Get settings
        const gs = await window.electronAPI.settings.get();
        const filled = fillDefaults(gs || {});
        setSettings(filled);
        setOriginal(filled);

        // Java 감지·캐시 통계는 여기서 미리 하지 않는다 — java 감지(~400ms)와 shared/ 전수 walk가
        // 설정 열기를 지연시킨다. 각각 Java 탭·캐시 탭 진입 시 lazy 로드(위 useEffect)로 옮겼다.

        // Get launcher version
        const versionResult = await window.electronAPI.launcher.getVersion();
        if (versionResult.success) {
          setCurrentVersion(versionResult.version);
        }

        // 저장된 혜니 인증 토큰 현황(표시 전용) 로드
        await loadTokens();
      } finally {
        setLoading(false);
      }
    })();

    // Listen for update events
    const cleanup1 = window.electronAPI.on('launcher:update-available', () => {
      setUpdateStatus('available');
      setCheckingUpdate(false);
    });
    
    const cleanup2 = window.electronAPI.on('launcher:update-not-available', () => {
      setUpdateStatus('not-available');
      setCheckingUpdate(false);
    });
    
    const cleanup3 = window.electronAPI.on('launcher:update-error', () => {
      setUpdateStatus('error');
      setCheckingUpdate(false);
    });

    return () => {
      mountedRef.current = false;
      cleanup1?.();
      cleanup2?.();
      cleanup3?.();
    };
  }, []);

  const update = (path: string, value: any) => {
    setSettings((prev) => {
      const copy: any = JSON.parse(JSON.stringify(prev || {}));
      const parts = path.split('.');
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        cur[key] = cur[key] ?? {};
        cur = cur[key];
      }
      cur[parts[parts.length - 1]] = value;
      return copy as GlobalSettings;
    });
  };

  // Memory validation with debounce
  useEffect(() => {
    if (!settings.java) return;
    
    const memMin = Number(settings.java.memory_min ?? 1024);
    const memMax = Number(settings.java.memory_max ?? 4096);
    
    if (memMin > memMax) {
      const timer = setTimeout(() => {
        setSettings(prev => {
          const copy = JSON.parse(JSON.stringify(prev || {}));
          if (!copy.java) copy.java = {};
          copy.java.memory_max = memMin;
          return copy;
        });
        toast.info('메모리 자동 조정', `최대 메모리가 ${memMin}MB로 자동 조정되었습니다.`);
      }, 500);
      return () => clearTimeout(timer);
    } else if (memMax < memMin) {
      const timer = setTimeout(() => {
        setSettings(prev => {
          const copy = JSON.parse(JSON.stringify(prev || {}));
          if (!copy.java) copy.java = {};
          copy.java.memory_min = memMax;
          return copy;
        });
        toast.info('메모리 자동 조정', `최소 메모리가 ${memMax}MB로 자동 조정되었습니다.`);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.java?.memory_min, settings.java?.memory_max, toast]);

  const isDirty = useMemo(() => JSON.stringify(settings ?? {}) !== JSON.stringify(original ?? {}), [settings, original]);
  const onCancel = () => navigate(-1);
  const onReset = () => setSettings(original);
  
  const onExport = async () => {
    try {
      const data = await window.electronAPI.settings.export();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hyenimc-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('내보내기 성공', '설정을 성공적으로 내보냈습니다.');
    } catch (error) {
      toast.error('내보내기 실패', '설정 내보내기에 실패했습니다.');
    }
  };
  
  const onImport = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const data = e.target?.result as string;
            const result = await window.electronAPI.settings.import(data);
            if (result.success) {
              toast.success('가져오기 성공', result.message);
              // Reload settings
              const gs = await window.electronAPI.settings.get();
              const filled = fillDefaults(gs || {});
              setSettings(filled);
              setOriginal(filled);
            } else {
              toast.error('가져오기 실패', result.message);
            }
          } catch (error) {
            toast.error('파일 오류', 'JSON 파싱에 실패했습니다.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    } catch (error) {
      toast.error('가져오기 실패', '설정 가져오기에 실패했습니다.');
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      // Backend will handle defaults, just send as-is
      await window.electronAPI.settings.update(settings);
      setOriginal(settings);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400">전역 설정을 불러오는 중...</div>;
  }

  return (
    <div className="h-full">
      <div className="max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold">전역 설정</h2>
            <p className="text-gray-400 text-sm mt-1">프로필 기본값으로 상속됩니다. 프로필에서 미설정 시 이 값이 사용됩니다.</p>
          </div>
          <div className="hidden md:flex gap-2">
            <button onClick={onExport} className="px-3 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-sm">내보내기</button>
            <button onClick={onImport} className="px-3 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg text-sm">가져오기</button>
            <div className="border-l border-gray-700 mx-1"></div>
            <button onClick={onCancel} className="px-3 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg">취소</button>
            <button onClick={onReset} disabled={!isDirty} className="px-3 py-2 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg disabled:opacity-50">되돌리기</button>
            <button onClick={onSave} disabled={!isDirty || saving} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg disabled:opacity-50">{saving ? '저장 중...' : '저장'}</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-800">
          <TabButton active={tab==='download'} onClick={() => setTab('download')}>다운로드</TabButton>
          <TabButton active={tab==='java'} onClick={() => setTab('java')}>Java</TabButton>
          <TabButton active={tab==='resolution'} onClick={() => setTab('resolution')}>해상도</TabButton>
          <TabButton active={tab==='cache'} onClick={() => setTab('cache')}>캐시</TabButton>
          <TabButton active={tab==='update'} onClick={() => setTab('update')}>자동 업데이트</TabButton>
          <TabButton active={tab==='auth'} onClick={() => setTab('auth')}>혜니 인증</TabButton>
        </div>

        {tab==='download' && (
          <SectionCard title="다운로드" subtitle="네트워크 품질에 맞춰 타임아웃/재시도/동시 다운로드 수를 조절합니다.">
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">요청 타임아웃 (ms)</span>
                  <input type="number" min="500" max="10000" step="100" value={s.download?.request_timeout_ms ?? 3000} onChange={(e)=>update('download.request_timeout_ms', Number(e.target.value))} className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right" />
                </div>
                <Slider min={500} max={10000} step={100} value={Number(s.download?.request_timeout_ms || 3000)} onChange={(v)=>update('download.request_timeout_ms', v)} />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>500 ms</span>
                  <span>10초</span>
                </div>
              </div>
              <div>
                <span className="text-sm text-gray-300 mb-3 block">재시도 횟수</span>
                <div className="grid grid-cols-5 gap-2">
                  {[1,3,5,7,10].map(n => (
                    <button key={n} onClick={()=>update('download.max_retries', n)} className={`py-3 text-sm rounded-lg border-2 ${s.download?.max_retries===n? 'border-purple-500 bg-purple-900/30 text-white':'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-750'}`}>{n}회</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-sm text-gray-300 mb-3 block">병렬 다운로드</span>
                <div className="grid grid-cols-6 gap-2">
                  {[4,6,8,10,12,16].map(n => (
                    <button key={n} onClick={()=>update('download.max_parallel', n)} className={`py-3 text-sm rounded-lg border-2 ${s.download?.max_parallel===n? 'border-purple-500 bg-purple-900/30 text-white':'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-750'}`}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {tab==='java' && (
          <SectionCard title="Java" subtitle="프로필에서 미설정 시 사용됩니다." action={<button disabled={javaLoading} onClick={async()=>{ setJavaLoading(true); try { const list=await window.electronAPI.java.detect(true); if(mountedRef.current) setJavaList(list||[]); } finally { if(mountedRef.current) setJavaLoading(false); } }} className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-750 disabled:opacity-50">{javaLoading ? '감지 중…' : '재감지'}</button>}>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-300 font-medium">Java 설치 목록</span>
                  <span className="text-xs text-gray-500">{javaList.length}개 감지됨</span>
                </div>
                {javaLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-2 mb-4">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Java 설치 감지 중…
                  </div>
                ) : javaList.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    {javaList.map(j => {
                      const active = s.java?.java_path === j.path;
                      return (
                        <button key={j.path} onClick={()=>update('java.java_path', j.path)} className={`w-full text-left p-4 rounded-lg border-2 transition-all ${active? 'border-purple-500 bg-purple-900/20':'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-gray-200">Java {j.majorVersion} ({j.architecture})</div>
                              <div className="text-xs text-gray-400 mt-0.5">{j.version}{j.vendor? ` · ${j.vendor}`:''}</div>
                              <div className="text-xs text-gray-500 truncate mt-1" title={j.path}>{j.path}</div>
                            </div>
                            {active && <span className="text-purple-400 ml-2 flex-shrink-0">✔</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-center mb-4">
                    <p className="text-sm text-gray-400">감지된 Java가 없습니다.</p>
                    <p className="text-xs text-gray-500 mt-1">"재감지" 버튼을 눌러 Java를 검색하거나, 아래에 직접 경로를 입력하세요.</p>
                  </div>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-400">직접 입력 (선택 사항)</span>
                  <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500" value={s.java?.java_path ?? ''} placeholder="예: C:\\Program Files\\Java\\bin\\java.exe" onChange={(e) => update('java.java_path', e.target.value)} />
                </label>
                <p className="text-xs text-gray-500 mt-1">위 목록에서 선택하거나, 경로를 직접 입력할 수 있습니다.</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">최소 메모리 (MB)</span>
                  <input 
                    type="number" 
                    min="256" 
                    max={Math.floor(systemMemory * 0.9)} 
                    step="256" 
                    value={s.java?.memory_min ?? 1024} 
                    onChange={(e)=> {
                      const val = e.target.value;
                      if (val === '' || isNaN(Number(val))) return;
                      update('java.memory_min', Number(val));
                    }}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (isNaN(val) || val < 256) {
                        update('java.memory_min', 1024);
                      }
                    }}
                    className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right" 
                  />
                </div>
                <Slider min={256} max={Math.floor(systemMemory * 0.5)} step={256} value={Number(s.java?.memory_min || 1024)} onChange={(v)=>update('java.memory_min', v)} />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>256 MB</span>
                  <span>{Math.floor(systemMemory * 0.5 / 1024)} GB</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">최대 메모리 (MB)</span>
                  <input 
                    type="number" 
                    min="512" 
                    max={Math.floor(systemMemory * 0.9)} 
                    step="512" 
                    value={s.java?.memory_max ?? 4096} 
                    onChange={(e)=> {
                      const val = e.target.value;
                      if (val === '' || isNaN(Number(val))) return;
                      update('java.memory_max', Number(val));
                    }}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (isNaN(val) || val < 512) {
                        update('java.memory_max', 4096);
                      }
                    }}
                    className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right" 
                  />
                </div>
                <Slider min={512} max={Math.floor(systemMemory * 0.9)} step={512} value={Number(s.java?.memory_max || 4096)} onChange={(v)=>update('java.memory_max', v)} />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>512 MB</span>
                  <span>{Math.floor(systemMemory * 0.9 / 1024)} GB (시스템의 90%)</span>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="text-xs text-gray-400 mb-2">메모리 할당 시각화</div>
                <div className="h-6 bg-gray-800 rounded-full overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-purple-600/50 to-purple-500/50 absolute" style={{ width: `${((s.java?.memory_min || 1024) / systemMemory) * 100}%` }} />
                  <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 absolute" style={{ left: `${((s.java?.memory_min || 1024) / systemMemory) * 100}%`, width: `${(((s.java?.memory_max || 4096) - (s.java?.memory_min || 1024)) / systemMemory) * 100}%` }} />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>최소</span>
                  <span>할당 범위</span>
                  <span>최대</span>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {tab==='resolution' && (
          <SectionCard title="해상도" subtitle="프리셋을 선택하거나 원하는 값을 직접 입력하세요.">
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { w: 854, h: 480, label: '480p' },
                  { w: 1280, h: 720, label: '720p' },
                  { w: 1920, h: 1080, label: '1080p' },
                  { w: 2560, h: 1440, label: '1440p' },
                  { w: 3840, h: 2160, label: '4K' },
                ].map(p => (
                  <button key={p.label} onClick={() => { update('resolution.width', p.w); update('resolution.height', p.h); }} className={`p-4 rounded-xl border-2 ${s.resolution?.width===p.w && s.resolution?.height===p.h ? 'border-purple-500 bg-purple-900/20':'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}>
                    <div className="text-center">
                      <div className={`text-lg font-semibold ${s.resolution?.width===p.w && s.resolution?.height===p.h ? 'text-white':'text-gray-200'}`}>{p.label}</div>
                      <div className="text-xs text-gray-400 mt-1">{p.w} × {p.h}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-400">너비</span>
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500" value={s.resolution?.width ?? ''} onChange={(e) => update('resolution.width', e.target.value === '' ? '' : Number(e.target.value))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-400">높이</span>
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500" value={s.resolution?.height ?? ''} onChange={(e) => update('resolution.height', e.target.value === '' ? '' : Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-2 select-none">
                  <input type="checkbox" className="accent-purple-500" checked={!!s.resolution?.fullscreen} onChange={(e) => update('resolution.fullscreen', e.target.checked)} />
                  <span className="text-sm text-gray-300">전체화면</span>
                </label>
              </div>
            </div>
          </SectionCard>
        )}

        {tab==='update' && (
          <SectionCard title="자동 업데이트" subtitle="런처 업데이트 확인 주기를 설정합니다.">
            <div className="space-y-6">
              {/* Current version */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-2">현재 버전</div>
                <div className="text-2xl font-semibold text-purple-400">{currentVersion || '불러오는 중...'}</div>
              </div>

              {/* Check interval */}
              <div>
                <span className="text-sm text-gray-300 mb-3 block">업데이트 확인 주기</span>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  {[
                    { hours: 1, label: '1시간' },
                    { hours: 2, label: '2시간' },
                    { hours: 4, label: '4시간' },
                    { hours: 6, label: '6시간' },
                    { hours: 12, label: '12시간' },
                    { hours: 24, label: '하루' },
                  ].map(option => (
                    <button 
                      key={option.hours} 
                      onClick={() => update('update.check_interval_hours', option.hours)} 
                      className={`py-3 text-sm rounded-lg border-2 ${
                        s.update?.check_interval_hours === option.hours
                          ? 'border-purple-500 bg-purple-900/30 text-white'
                          : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-750'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto download */}
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox" 
                  id="auto-download"
                  className="w-4 h-4 accent-purple-500" 
                  checked={s.update?.auto_download ?? false} 
                  onChange={(e) => update('update.auto_download', e.target.checked)} 
                />
                <label htmlFor="auto-download" className="text-sm text-gray-300 select-none cursor-pointer">
                  업데이트 발견 시 자동 다운로드
                </label>
              </div>

              {/* Manual check button */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-3">수동 업데이트 확인</div>
                <button
                  onClick={async () => {
                    setCheckingUpdate(true);
                    setUpdateStatus('checking');
                    try {
                      await window.electronAPI.launcher.checkForUpdates();
                      // Wait for the event listener to set the status
                      setTimeout(() => {
                        setCheckingUpdate(false);
                      }, 3000);
                    } catch (error) {
                      setUpdateStatus('error');
                      setCheckingUpdate(false);
                      toast.error('업데이트 확인 실패', '업데이트 확인 중 오류가 발생했습니다.');
                    }
                  }}
                  disabled={checkingUpdate}
                  className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {checkingUpdate ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>확인 중...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      <span>업데이트 확인</span>
                    </>
                  )}
                </button>
                
                {updateStatus === 'available' && (
                  <div className="mt-3 p-3 bg-green-900/20 border border-green-500/30 rounded-lg text-sm text-green-300">
                    <CheckCircle2 className="w-4 h-4 inline mr-2" />
                    새로운 업데이트를 사용할 수 있습니다!
                  </div>
                )}
                {updateStatus === 'not-available' && (
                  <div className="mt-3 p-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400">
                    <CheckCircle2 className="w-4 h-4 inline mr-2" />
                    최신 버전을 사용 중입니다.
                  </div>
                )}
                {updateStatus === 'error' && (
                  <div className="mt-3 p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-sm text-red-300">
                    업데이트 확인 중 오류가 발생했습니다.
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {tab==='cache' && (
          <SectionCard title="캐시" subtitle="공유 캐시(에셋/라이브러리)의 용량과 TTL을 관리합니다.">
            <div className="space-y-6">
              {/* Cache statistics */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-3">캐시 통계</div>
                {cacheStats === null || cacheStatsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    캐시 용량 측정 중…
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-2xl font-semibold text-purple-400">{(cacheStats.size / 1024 / 1024 / 1024).toFixed(2)} GB</div>
                      <div className="text-xs text-gray-500">현재 사용량</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-purple-400">{cacheStats.files.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">캐시된 파일 수</div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Cache settings */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-2 select-none">
                  <input type="checkbox" className="accent-purple-500" checked={s.cache?.enabled ?? true} onChange={(e) => update('cache.enabled', e.target.checked)} />
                  <span className="text-sm text-gray-300">활성화</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-400">최대 용량(GB)</span>
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500" value={s.cache?.max_size_gb ?? ''} onChange={(e) => update('cache.max_size_gb', e.target.value === '' ? '' : Number(e.target.value))} />
                  <span className="text-xs text-gray-500">기본 10GB</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-400">TTL(일)</span>
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500" value={s.cache?.ttl_days ?? ''} onChange={(e) => update('cache.ttl_days', e.target.value === '' ? '' : Number(e.target.value))} />
                  <span className="text-xs text-gray-500">기본 30일</span>
                </label>
              </div>
              
              {/* Danger zone */}
              <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-4">
                <div className="text-sm font-medium text-red-400 mb-2">위험 영역</div>
                <div className="text-xs text-gray-400 mb-3">캐시를 삭제하면 모든 다운로드된 에셋과 라이브러리가 제거되며, 다음 게임 실행 시 다시 다운로드됩니다.</div>
                <button 
                  onClick={async () => {
                    if (confirm('정말로 모든 캐시를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                      const result = await window.electronAPI.settings.resetCache();
                      if (result.success) {
                        toast.success('캐시 삭제 완료', result.message);
                        await loadCacheStats(); // 삭제 후 재측정(측정 중 표시 포함)
                      } else {
                        toast.error('캐시 삭제 실패', result.message);
                      }
                    }
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  캐시 전체 삭제
                </button>
              </div>
            </div>
          </SectionCard>
        )}

        {/* 혜니 인증 탭 — 저장된 인증 현황(표시 전용). 방송 노출 안전: 서버 주소·토큰 값 미표시 */}
        {tab==='auth' && (
        <SectionCard
          title="혜니 인증"
          subtitle="Discord /인증으로 받은 인증 현황입니다. 서버 주소와 토큰 값은 표시되지 않습니다."
          action={
            <button
              onClick={loadTokens}
              className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-750"
            >
              새로고침
            </button>
          }
        >
          {tokensError ? (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-400">확인할 수 없습니다</p>
            </div>
          ) : tokens === null ? (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-400">불러오는 중...</p>
            </div>
          ) : tokens.length === 0 ? (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-400">저장된 인증이 없습니다.</p>
              <p className="text-xs text-gray-500 mt-1">Discord에서 /인증 명령어로 인증하세요.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-gray-300">인증 {tokens.length}개 저장됨</div>
              <div className="space-y-2">
                {tokens.map((t, i) => {
                  const label = t.servers.length > 0
                    ? `서버 ${t.servers.length}곳에서 사용하는 인증`
                    : '일반 인증 (대상 서버 미지정)';
                  return (
                    <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-4">
                      <div className="text-sm text-gray-200 min-w-0 truncate">{label}</div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-xs text-gray-500">
                          {new Date(t.receivedAt * 1000).toLocaleString()} 등록
                        </div>
                        <button
                          onClick={() => setTokenToDelete({ receivedAt: t.receivedAt, label })}
                          title="이 기기에서 인증 제거"
                          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SectionCard>
        )}

        <ConfirmDialog
          isOpen={tokenToDelete !== null}
          variant="danger"
          title="인증 제거"
          message={`'${tokenToDelete?.label ?? ''}'을(를) 이 기기에서 제거합니다.\n\n로컬에서만 제거되며 서버측 인증은 만료 시까지 유효합니다. 다시 사용하려면 Discord /인증으로 재인증하세요.`}
          confirmText={removingToken ? '제거 중...' : '제거'}
          cancelText="취소"
          onConfirm={handleRemoveToken}
          onCancel={() => setTokenToDelete(null)}
        />

        {/* Sticky action bar for small screens */}
        <div className="md:hidden sticky bottom-0 left-0 right-0 bg-gray-900/90 backdrop-blur border-t border-gray-800 px-4 py-3 flex gap-2">
          <button onClick={onCancel} className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg">취소</button>
          <button onClick={onReset} disabled={!isDirty} className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-50">되돌리기</button>
          <button onClick={onSave} disabled={!isDirty || saving} className="flex-1 px-3 py-2 bg-purple-600 rounded-lg disabled:opacity-50">{saving ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm border-b-2 ${active ? 'border-purple-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'}`}>
      {children}
    </button>
  );
}

function fillDefaults(gs: GlobalSettings): GlobalSettings {
  const out: GlobalSettings = { ...(gs || {}) };
  out.download = {
    request_timeout_ms: gs.download?.request_timeout_ms ?? 3000,
    max_retries: gs.download?.max_retries ?? 5,
    max_parallel: gs.download?.max_parallel ?? 10,
  };
  out.java = {
    java_path: gs.java?.java_path ?? '',
    memory_min: gs.java?.memory_min ?? 1024,
    memory_max: gs.java?.memory_max ?? 4096,
  };
  out.resolution = {
    width: gs.resolution?.width ?? 854,
    height: gs.resolution?.height ?? 480,
    fullscreen: gs.resolution?.fullscreen ?? false,
  };
  out.cache = {
    enabled: gs.cache?.enabled ?? true,
    max_size_gb: gs.cache?.max_size_gb ?? 10,
    ttl_days: gs.cache?.ttl_days ?? 30,
  };
  out.update = {
    check_interval_hours: gs.update?.check_interval_hours ?? 2,
    auto_download: gs.update?.auto_download ?? false,
  };
  return out;
}
