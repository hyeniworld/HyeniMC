import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { X, Loader2, Package, Folder, File, ChevronRight, ChevronDown, Minus } from 'lucide-react';
import type { FileTreeNode } from '../../../shared/types/hyenipack';

interface ExportHyeniPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
  profileName: string;
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  toggleNode: (path: string) => void;
  getCheckState: (node: FileTreeNode) => 'all' | 'some' | 'none';
}

// 트리 노드 컴포넌트 (Hooks 사용 가능)
function TreeNode({ node, depth, expandedFolders, toggleFolder, toggleNode, getCheckState }: TreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);
  const paddingLeft = depth * 32 + 8;
  const checkboxRef = useRef<HTMLInputElement>(null);
  
  // 폴더인 경우 체크 상태 계산
  const checkState = node.type === 'directory' ? getCheckState(node) : (node.checked ? 'all' : 'none');
  
  // indeterminate 상태 설정
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = checkState === 'some';
    }
  }, [checkState]);
  
  return (
    <div>
      <div
        className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer"
        style={{ 
          paddingLeft: `${paddingLeft}px`,
          backgroundColor: depth > 0 ? 'rgba(55, 65, 81, 0.3)' : 'transparent'
        }}
      >
        {/* 화살표 공간 */}
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          {node.type === 'directory' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.path);
              }}
              className="p-0.5"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
            </button>
          )}
        </div>
        
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={checkState === 'all'}
          onChange={() => toggleNode(node.path)}
          className="rounded flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        />
        
        {node.type === 'directory' ? (
          <Folder className="h-4 w-4 text-blue-400" />
        ) : (
          <File className="h-4 w-4 text-gray-400" />
        )}
        
        <span className="text-sm text-gray-200 flex-1">{node.name}</span>
        
        {node.type === 'file' && node.size && (
          <span className="text-xs text-gray-500">
            {(node.size / 1024).toFixed(1)} KB
          </span>
        )}
      </div>
      
      {node.type === 'directory' && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              toggleNode={toggleNode}
              getCheckState={getCheckState}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExportHyeniPackModal({ isOpen, onClose, profileId, profileName }: ExportHyeniPackModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  
  // 기본 정보
  const [packName, setPackName] = useState(profileName);
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [hyenipackId, setHyenipackId] = useState(
    profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  );
  const [changelog, setChangelog] = useState('');
  const [breaking, setBreaking] = useState(false);
  // 정책: 자동 관리 폴더(mods/resourcepacks/shaderpacks) 외 최상위 경로별 keep/replace
  const [policies, setPolicies] = useState<Record<string, 'keep' | 'replace'>>({});
  
  // 파일 트리
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['mods', 'config', 'resourcepacks', 'shaderpacks']));
  
  // 파일 트리 로드
  useEffect(() => {
    if (isOpen) {
      loadFileTree();
    }
  }, [isOpen, profileId]);
  
  const loadFileTree = async () => {
    try {
      setLoadingTree(true);
      const profile = await window.electronAPI.profile.get(profileId);
      const instanceDir = profile.gameDirectory;
      
      const result = await window.electronAPI.hyenipack.getFileTree(instanceDir);
      if (result.success && result.tree) {
        // 기본적으로 mods, config, resourcepacks, shaderpacks 폴더 체크
        const updatedTree = result.tree.map((node: FileTreeNode) => {
          if (node.name === 'mods' || node.name === 'config' || 
              node.name === 'resourcepacks' || node.name === 'shaderpacks') {
            return checkAllChildren({ ...node, checked: true });
          }
          return node;
        });
        setFileTree(updatedTree);
      }
    } catch (error) {
      console.error('Failed to load file tree:', error);
      toast.error('파일 목록을 불러올 수 없습니다');
    } finally {
      setLoadingTree(false);
    }
  };
  
  // 하위 항목 모두 체크/해제
  const checkAllChildren = (node: FileTreeNode): FileTreeNode => ({
    ...node,
    checked: node.checked,
    children: node.children?.map(child => checkAllChildren({ ...child, checked: node.checked }))
  });
  
  // 파일/폴더 체크 토글
  const toggleNode = (nodePath: string) => {
    const updateTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map(node => {
        if (node.path === nodePath) {
          const newChecked = !node.checked;
          return checkAllChildren({ ...node, checked: newChecked });
        }
        if (node.children) {
          return { ...node, children: updateTree(node.children) };
        }
        return node;
      });
    };
    setFileTree(updateTree(fileTree));
  };
  
  // 폴더 확장/축소
  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };
  
  // 선택된 파일들 수집
  const getSelectedFiles = (nodes: FileTreeNode[]): string[] => {
    const selected: string[] = [];
    const traverse = (n: FileTreeNode) => {
      if (n.checked && n.type === 'file') {
        selected.push(n.path);
      }
      if (n.children) {
        n.children.forEach(traverse);
      }
    };
    nodes.forEach(traverse);
    return selected;
  };
  
  // 폴더의 체크 상태 계산 (전체/부분/없음)
  const getCheckState = (node: FileTreeNode): 'all' | 'some' | 'none' => {
    if (!node.children || node.children.length === 0) {
      return node.checked ? 'all' : 'none';
    }
    
    const childStates = node.children.map(child => {
      if (child.type === 'directory') {
        return getCheckState(child);
      }
      return child.checked ? 'all' : 'none';
    });
    
    const allChecked = childStates.every(s => s === 'all');
    const noneChecked = childStates.every(s => s === 'none');
    
    if (allChecked) return 'all';
    if (noneChecked) return 'none';
    return 'some';
  };
  
  // 내보내기 실행
  const handleExport = async () => {
    if (!packName.trim()) {
      toast.error('모드팩 이름을 입력해주세요');
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(hyenipackId)) {
      toast.error('혜니팩 ID는 소문자/숫자/하이픈만, 최대 64자입니다');
      return;
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      toast.error('버전은 x.y.z SemVer 형식이어야 합니다');
      return;
    }

    const selectedFiles = getSelectedFiles(fileTree);
    if (selectedFiles.length === 0) {
      toast.error('최소 1개 이상의 파일을 선택해주세요');
      return;
    }
    
    // 저장 위치 선택 (다이얼로그가 자동으로 덮어쓰기 확인)
    const suggestedFileName = `${packName}-${version}.hyenipack`;
    const savePath = await window.electronAPI.dialog.showSaveDialog({
      title: '혜니팩 저장',
      defaultPath: suggestedFileName,
      filters: [
        { name: 'HyeniPack', extensions: ['hyenipack'] }
      ]
    });
    
    if (!savePath) {
      return; // 취소됨
    }
    
    setLoading(true);
    
    try {
      const overridePolicies = Object.entries(policies).map(([p, policy]) => ({ path: p, policy }));

      const options = {
        packName,
        version,
        author,
        description,
        selectedFiles,
        hyenipackId,
        changelog: changelog || undefined,
        breaking,
        overridePolicies,
      };

      const result = await window.electronAPI.hyenipack.export(profileId, options, savePath);

      if (result.success) {
        toast.success(`혜니팩이 생성되었습니다: ${savePath} (배포용 latest.json이 같은 폴더에 함께 생성됨)`);
        onClose();
      } else {
        throw new Error(result.error || '내보내기 실패');
      }
    } catch (error: any) {
      console.error('Export failed:', error);
      toast.error(error.message || '내보내기에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };
  
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-purple-500" />
            <h2 className="text-xl font-semibold text-gray-100">혜니팩 내보내기</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            disabled={loading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. 기본 정보 */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-300">기본 정보</h3>
            
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">모드팩 이름 *</label>
              <input
                type="text"
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500"
                placeholder="나의 모드팩"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">혜니팩 ID *</label>
              <input
                type="text"
                value={hyenipackId}
                onChange={(e) => setHyenipackId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500 font-mono"
                placeholder="hyenipack-hyeniworld"
              />
              <p className="text-xs text-gray-500 mt-1">
                소문자/숫자/하이픈만, 최대 64자. 자동 업데이트 채널의 고유 식별자 — 배포 후 변경 금지
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">버전</label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500"
                  placeholder="1.0.0"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">제작자</label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500"
                  placeholder="Your Name"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">설명</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500"
                placeholder="모드팩에 대한 설명..."
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">변경 사항 (changelog)</label>
              <textarea
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                className="w-full px-3 py-2 border border-gray-700 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500"
                placeholder={'- Sodium 업데이트\n- Config 최적화'}
                rows={3}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={breaking}
                onChange={(e) => setBreaking(e.target.checked)}
                className="rounded border-gray-700 bg-gray-800"
              />
              <span>호환성 파괴 업데이트 (사용자는 적용 전까지 게임 실행 불가)</span>
            </label>
          </div>

          {/* 2. 파일 트리 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">
              포함할 파일 선택 ({getSelectedFiles(fileTree).length}개 선택됨)
            </h3>
            
            <div className="border border-gray-700 rounded-lg max-h-96 overflow-y-auto bg-gray-800">
              {loadingTree ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                </div>
              ) : fileTree.length === 0 ? (
                <div className="text-center p-8 text-gray-500">파일이 없습니다</div>
              ) : (
                <div className="p-2">
                  {fileTree.map(node => (
                    <TreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      expandedFolders={expandedFolders}
                      toggleFolder={toggleFolder}
                      toggleNode={toggleNode}
                      getCheckState={getCheckState}
                    />
                  ))}
                </div>
              )}
            </div>
            
            <p className="text-xs text-gray-500">
              💡 폴더를 선택하면 하위 파일이 모두 포함됩니다. saves, logs 등은 자동으로 제외됩니다.
            </p>

            {/* V2: override 정책 (자동 관리 폴더 제외 최상위 경로) */}
            {(() => {
              const AUTO_MANAGED = new Set(['mods', 'resourcepacks', 'shaderpacks']);
              const topDirs = Array.from(
                new Set(
                  getSelectedFiles(fileTree)
                    .map((p) => p.split(/[/\\]/)[0])
                    .filter((d) => d && !AUTO_MANAGED.has(d))
                )
              ).sort();
              if (topDirs.length === 0) return null;
              return (
                <div className="mt-3">
                  <label className="block text-sm font-medium mb-1 text-gray-300">업데이트 정책 (폴더별)</label>
                  <p className="text-xs text-gray-500 mb-2">
                    keep: 사용자 변경 보존(새 파일만 추가) / replace: 팩 내용으로 강제 교체
                  </p>
                  {topDirs.map((dir) => (
                    <div key={dir} className="flex items-center justify-between py-1 text-sm text-gray-300">
                      <span className="font-mono">{dir}/</span>
                      <select
                        value={policies[dir] ?? 'keep'}
                        onChange={(e) =>
                          setPolicies((prev) => ({ ...prev, [dir]: e.target.value as 'keep' | 'replace' }))
                        }
                        className="px-2 py-1 border border-gray-700 rounded-lg bg-gray-800 text-gray-100"
                      >
                        <option value="keep">keep (기본)</option>
                        <option value="replace">replace</option>
                      </select>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
            disabled={loading}
          >
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={loading || getSelectedFiles(fileTree).length === 0}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
