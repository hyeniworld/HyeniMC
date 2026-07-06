//! 데이터 디렉터리 경로 결정.
//!
//! 기존 Electron 판은 Go 데몬을 `HYENIMC_DATA_DIR = <Electron userData>/data`로 spawn했다
//! (src/main/backend/manager.ts). Electron userData의 앱 이름은 package.json name = "hyenimc".
//! in-place 호환을 위해 Tauri 판도 동일 경로를 본다. `~/.hyenimc`는 Go 단독 실행 시의
//! 폴백일 뿐 실사용 데이터가 아니다 (2026-07-06 실측: schema_version만 존재).

use std::path::PathBuf;

/// 기존 Electron 판이 쓰던 데이터 디렉터리 (플랫폼별 Electron userData/data).
pub fn legacy_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library/Application Support/hyenimc/data")
        })
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("hyenimc").join("data"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Electron userData on Linux = $XDG_CONFIG_HOME|~/.config/<name>
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|base| base.join("hyenimc").join("data"))
    }
}

/// 데이터 디렉터리 내 SQLite DB 경로.
pub fn database_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("hyenimc.db")
}

/// Electron userData 루트 (data의 상위). 인스턴스/에셋 등이 이 아래에 있다.
pub fn legacy_user_data_dir() -> Option<PathBuf> {
    legacy_data_dir().map(|d| d.parent().map(|p| p.to_path_buf()).unwrap_or(d))
}

/// 프로필 인스턴스 루트 — 실DB 실측: `<userData>/instances/<uuid>`
pub fn instances_dir() -> Option<PathBuf> {
    legacy_user_data_dir().map(|d| d.join("instances"))
}
