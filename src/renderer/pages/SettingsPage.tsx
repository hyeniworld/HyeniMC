import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../components/common/SectionCard';
import { Slider } from '../components/common/Slider';
import { useToast } from '../contexts/ToastContext';

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

type GlobalSettings = {
  download?: DownloadSettings;
  java?: JavaSettings;
  resolution?: ResolutionSettings;
  cache?: CacheSettings;
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings>({});
  const [original, setOriginal] = useState<GlobalSettings>({});
  const [tab, setTab] = useState<'download'|'java'|'resolution'|'cache'>('download');
  const [javaList, setJavaList] = useState<Array<{ path: string; version: string; majorVersion: number; vendor?: string; architecture: string }>>([]);
  const [systemMemory, setSystemMemory] = useState(16384);
  const [cacheStats, setCacheStats] = useState<{ size: number; files: number }>({ size: 0, files: 0 });
  const s = settings;

  useEffect(() => {
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
        
        // Get cached Java installations (no re-detection)
        const cachedJava = await window.electronAPI.java.getCached();
        setJavaList(cachedJava || []);
        
        // Get cache stats
        const stats = await window.electronAPI.settings.getCacheStats();
        setCacheStats(stats);
      } finally {
        setLoading(false);
      }
    })();
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
          <SectionCard title="Java" subtitle="프로필에서 미설정 시 사용됩니다." action={<button onClick={async()=>{ const list=await window.electronAPI.java.detect(true); setJavaList(list||[]); }} className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-750">재감지</button>}>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-300 font-medium">Java 설치 목록</span>
                  <span className="text-xs text-gray-500">{javaList.length}개 감지됨</span>
                </div>
                {javaList.length > 0 ? (
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
                  <input type="number" min="256" max={Math.floor(systemMemory * 0.9)} step="256" value={s.java?.memory_min ?? 1024} onChange={(e)=>update('java.memory_min', Number(e.target.value))} className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right" />
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
                  <input type="number" min="512" max={Math.floor(systemMemory * 0.9)} step="512" value={s.java?.memory_max ?? 4096} onChange={(e)=>update('java.memory_max', Number(e.target.value))} className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-right" />
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

        {tab==='cache' && (
          <SectionCard title="캐시" subtitle="공유 캐시(에셋/라이브러리)의 용량과 TTL을 관리합니다.">
            <div className="space-y-6">
              {/* Cache statistics */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-3">캐시 통계</div>
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
                        const stats = await window.electronAPI.settings.getCacheStats();
                        setCacheStats(stats);
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
  return out;
}
