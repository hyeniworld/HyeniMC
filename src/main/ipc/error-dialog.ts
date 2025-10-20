import { ipcMain, BrowserWindow, shell } from 'electron';

/**
 * ErrorDialog IPC handlers
 */
export function registerErrorDialogHandlers() {
  // Execute action from error dialog
  ipcMain.handle('error-dialog:execute-action', async (event, action: string) => {
    console.log('[ErrorDialog] Executing action:', action);
    
    try {
      switch (action) {
        case 'openJavaInstallGuide':
          await shell.openExternal('https://www.java.com/ko/download/');
          break;
        
        case 'resetJavaPath':
          // Java 경로를 자동 선택으로 변경
          // Profile update는 renderer에서 처리
          break;
        
        case 'selectDifferentJava':
          // Java 선택 다이얼로그 열기
          // Renderer에서 처리
          break;
        
        case 'fixJavaVersion':
          // Java 버전 자동 수정
          // ConfigurationFixer에서 처리 후 profile update
          break;
        
        case 'fixDangerousMemory':
        case 'reduceMinMemory':
        case 'reduceMaxMemory':
        case 'adjustMemory':
          // 메모리 설정 자동 수정
          // ConfigurationFixer에서 처리 후 profile update
          break;
        
        case 'selectGameDirectory':
        case 'createOrSelectDirectory':
          // 디렉토리 선택 다이얼로그
          // Renderer에서 처리
          break;
        
        case 'reinstallProfile':
          // 프로필 재설치
          // Renderer에서 처리
          break;
        
        case 'close':
          // 다이얼로그 닫기만
          break;
        
        case 'retry':
          // 재시도
          // Renderer에서 처리
          break;
        
        default:
          console.warn('[ErrorDialog] Unknown action:', action);
      }
    } catch (error) {
      console.error('[ErrorDialog] Action failed:', error);
      throw error;
    }
  });
}

/**
 * Show error dialog to renderer
 */
export function showErrorDialog(window: BrowserWindow | null, errorData: any) {
  if (!window) {
    console.error('[ErrorDialog] No window available');
    return;
  }
  
  console.log('[ErrorDialog] Showing error:', errorData.title);
  window.webContents.send('show-error-dialog', errorData);
}
