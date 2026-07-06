//! JVM/게임 인자 조립(순수) + 게임 프로세스 spawn/로그 스트림.
//! TS game-launcher.ts buildJvmArguments/buildGameArguments의 의미 포팅.

use std::path::Path;

use crate::install::GameDirs;
use crate::manifest::{ArgumentEntry, ArgumentValue, VersionDetail};
use crate::rules::rules_allow;
use crate::LauncherError;

#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub profile_id: String,
    pub version_id: String,
    pub java_path: String,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    pub username: String,
    pub uuid: String,
    pub access_token: Option<String>,
    pub user_type: Option<String>,
    pub resolution: Option<(u32, u32)>,
    pub fullscreen: bool,
}

/// "group:artifact:version" → "group/path/artifact/version/artifact-version.jar"
pub fn maven_relative_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    Some(format!(
        "{}/{artifact}/{version}/{artifact}-{version}.jar",
        group.replace('.', "/")
    ))
}

/// 클래스패스: rules 통과 라이브러리(인스턴스 → 공유 폴백) + 클라이언트 jar.
/// 반환: (classpath 문자열, 어디에도 없는 라이브러리 이름들)
pub fn build_classpath(detail: &VersionDetail, dirs: &GameDirs) -> (String, Vec<String>) {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut parts: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();

    for lib in &detail.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        let rel = lib
            .downloads
            .as_ref()
            .and_then(|d| d.artifact.as_ref())
            .and_then(|a| a.path.clone())
            .or_else(|| maven_relative_path(&lib.name));
        let Some(rel) = rel else { continue };

        let instance_path = dirs.instance_libraries().join(&rel);
        let shared_path = dirs.shared_libraries.join(&rel);
        if instance_path.exists() {
            parts.push(instance_path.display().to_string());
        } else {
            if !shared_path.exists() {
                missing.push(lib.name.clone());
            }
            // 누락이어도 공유 경로를 넣어 에러 메시지가 명확하게 (TS 동일)
            parts.push(shared_path.display().to_string());
        }
    }

    parts.push(dirs.client_jar(&detail.id).display().to_string());
    (parts.join(sep), missing)
}

/// JVM + mainClass + 게임 인자 전체 조립 (TS 순서 그대로).
pub fn build_arguments(
    detail: &VersionDetail,
    spec: &LaunchSpec,
    dirs: &GameDirs,
    natives_dir: &Path,
    classpath: &str,
) -> Result<Vec<String>, LauncherError> {
    let mut args: Vec<String> = Vec::new();

    // macOS: GLFW 첫 스레드
    if cfg!(target_os = "macos") {
        args.push("-XstartOnFirstThread".into());
    }

    // 메모리 (min > max 보정)
    let min = spec.min_memory_mb.max(1);
    let max = spec.max_memory_mb.max(min);
    args.push(format!("-Xms{min}M"));
    args.push(format!("-Xmx{max}M"));

    args.push(format!("-Djava.library.path={}", natives_dir.display()));
    args.push("-cp".into());
    args.push(classpath.to_string());

    // G1GC 튜닝 (TS 고정 세트)
    for a in [
        "-XX:+UnlockExperimentalVMOptions",
        "-XX:+UseG1GC",
        "-XX:G1NewSizePercent=20",
        "-XX:G1ReservePercent=20",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=32M",
    ] {
        args.push(a.into());
    }

    // 매니페스트 jvm 인자 — TS와 동일하게 Plain 문자열만, 중복 스킵
    let sep = if cfg!(windows) { ";" } else { ":" };
    let instance_libs = dirs.instance_libraries().display().to_string();
    if let Some(arguments) = &detail.arguments {
        for entry in &arguments.jvm {
            if let ArgumentEntry::Plain(arg) = entry {
                if arg.contains("${natives_directory}")
                    || arg.contains("${classpath}")
                    || arg == "-cp"
                {
                    continue;
                }
                let processed = arg
                    .replace("${library_directory}", &instance_libs)
                    .replace("${classpath_separator}", sep)
                    .replace("${version_name}", &spec.version_id)
                    .replace("${launcher_name}", "HyeniMC")
                    .replace("${launcher_version}", "1.0.0");
                args.push(processed);
            }
        }
    }

    // mainClass
    let main_class = detail
        .main_class
        .as_ref()
        .ok_or_else(|| LauncherError::Other(format!("mainClass 없음: {}", detail.id)))?;
    args.push(main_class.clone());

    // 게임 인자 치환 테이블 (TS와 동일)
    let (res_w, res_h) = spec.resolution.unwrap_or((854, 480));
    let access_token = spec.access_token.clone().unwrap_or_else(|| "null".into());
    let user_type = spec.user_type.clone().unwrap_or_else(|| "legacy".into());
    let assets_index = detail
        .asset_index
        .as_ref()
        .map(|a| a.id.clone())
        .or_else(|| detail.assets.clone())
        .unwrap_or_else(|| "legacy".into());
    let substitute = |arg: &str| -> String {
        arg.replace("${auth_player_name}", &spec.username)
            .replace("${version_name}", &spec.version_id)
            .replace("${game_directory}", &dirs.instance_dir.display().to_string())
            .replace("${assets_root}", &dirs.shared_assets.display().to_string())
            .replace("${assets_index_name}", &assets_index)
            .replace("${auth_uuid}", &spec.uuid)
            .replace("${auth_access_token}", &access_token)
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${user_properties}", "{}")
            .replace("${clientid}", &spec.uuid)
            .replace("${auth_xuid}", &spec.uuid)
            .replace("${resolution_width}", &res_w.to_string())
            .replace("${resolution_height}", &res_h.to_string())
    };

    // quickPlay 인자쌍 필터
    const QUICK_PLAY: [&str; 4] = [
        "--quickPlayPath",
        "--quickPlaySingleplayer",
        "--quickPlayMultiplayer",
        "--quickPlayRealms",
    ];

    let mut game_args: Vec<String> = Vec::new();
    if let Some(legacy) = &detail.minecraft_arguments {
        game_args.extend(legacy.split(' ').map(String::from));
    } else if let Some(arguments) = &detail.arguments {
        for entry in &arguments.game {
            match entry {
                ArgumentEntry::Plain(s) => game_args.push(s.clone()),
                ArgumentEntry::Conditional { rules, value } => {
                    if rules_allow(rules) {
                        match value {
                            ArgumentValue::One(s) => game_args.push(s.clone()),
                            ArgumentValue::Many(v) => game_args.extend(v.iter().cloned()),
                        }
                    }
                }
            }
        }
    }

    let mut skip_next = false;
    for arg in &game_args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if QUICK_PLAY.contains(&arg.as_str()) {
            skip_next = true;
            continue;
        }
        args.push(substitute(arg));
    }

    if spec.fullscreen {
        args.push("--fullscreen".into());
    }

    Ok(args)
}

/// 실행 중인 게임 핸들 — kill 신호 전송용. 종료 감시 태스크가 Child 소유권을 가진다.
pub struct GameHandle {
    pub pid: Option<u32>,
    kill_tx: tokio::sync::oneshot::Sender<()>,
}

impl GameHandle {
    /// 강제 종료 요청. 이미 종료됐으면 no-op.
    pub fn kill(self) {
        let _ = self.kill_tx.send(());
    }
}

/// 게임 프로세스 spawn — stdout/stderr 라인을 on_log로, 종료 시 on_exit(code).
/// kill로 강제 종료 시 on_exit(None).
pub async fn spawn_game(
    java: &str,
    args: &[String],
    cwd: &Path,
    mut on_log: impl FnMut(String) + Send + 'static,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> Result<GameHandle, LauncherError> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    tokio::fs::create_dir_all(cwd).await?;
    let mut child = tokio::process::Command::new(java)
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    if let Some(out) = stdout {
        let tx = log_tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    let _ = tx.send(line);
                }
            }
        });
    }
    if let Some(err) = stderr {
        let tx = log_tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    let _ = tx.send(format!("[ERROR] {line}"));
                }
            }
        });
    }
    drop(log_tx);

    tokio::spawn(async move {
        while let Some(line) = log_rx.recv().await {
            on_log(line);
        }
    });

    let pid = child.id();
    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        tokio::select! {
            status = child.wait() => {
                on_exit(status.ok().and_then(|s| s.code()));
            }
            _ = kill_rx => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                on_exit(None);
            }
        }
    });

    Ok(GameHandle { pid, kill_tx })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_detail() -> VersionDetail {
        serde_json::from_str(
            r#"{
              "id":"1.21.1",
              "mainClass":"net.minecraft.client.main.Main",
              "assetIndex":{"id":"17","sha1":"a","url":"u"},
              "arguments":{
                "game":["--username","${auth_player_name}","--quickPlayMultiplayer","srv:25565","--gameDir","${game_directory}",
                        {"rules":[{"action":"allow","features":{"is_demo_user":true}}],"value":"--demo"}],
                "jvm":["-Dio.netty.native.workdir=${natives_directory}","-Dminecraft.launcher.brand=${launcher_name}","-cp","${classpath}"]
              },
              "libraries":[{"name":"a:b:1","downloads":{"artifact":{"path":"a/b/1/b-1.jar","sha1":"s","size":1,"url":"u"}}},
                           {"name":"net.fabricmc:loader:0.16"}]
            }"#,
        )
        .unwrap()
    }

    fn fixture_dirs(tmp: &tempfile::TempDir) -> GameDirs {
        GameDirs {
            instance_dir: tmp.path().join("inst"),
            shared_libraries: tmp.path().join("shared/libraries"),
            shared_assets: tmp.path().join("shared/assets"),
        }
    }

    fn fixture_spec() -> LaunchSpec {
        LaunchSpec {
            profile_id: "p1".into(),
            version_id: "1.21.1".into(),
            java_path: "java".into(),
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            username: "혜니".into(),
            uuid: "00000000-0000-0000-0000-000000000000".into(),
            access_token: None,
            user_type: None,
            resolution: None,
            fullscreen: false,
        }
    }

    #[test]
    fn maven_path_derivation() {
        assert_eq!(
            maven_relative_path("net.fabricmc:fabric-loader:0.17.2").as_deref(),
            Some("net/fabricmc/fabric-loader/0.17.2/fabric-loader-0.17.2.jar")
        );
        assert_eq!(maven_relative_path("bad"), None);
    }

    #[test]
    fn classpath_prefers_instance_then_shared_and_reports_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = fixture_dirs(&tmp);
        // 공유에 첫 라이브러리만 존재
        let shared_lib = dirs.shared_libraries.join("a/b/1/b-1.jar");
        std::fs::create_dir_all(shared_lib.parent().unwrap()).unwrap();
        std::fs::write(&shared_lib, b"x").unwrap();

        let (cp, missing) = build_classpath(&fixture_detail(), &dirs);
        assert!(cp.contains("a/b/1/b-1.jar"));
        assert!(cp.contains("fabric-loader") == false); // maven 파생 경로는 loader 이름 기준
        assert!(cp.contains("net/fabricmc/loader/0.16/loader-0.16.jar"));
        assert!(cp.ends_with(&dirs.client_jar("1.21.1").display().to_string()));
        assert_eq!(missing, vec!["net.fabricmc:loader:0.16".to_string()]);
    }

    #[test]
    fn builds_arguments_in_ts_order_with_substitution() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = fixture_dirs(&tmp);
        let natives = tmp.path().join("natives");
        let args =
            build_arguments(&fixture_detail(), &fixture_spec(), &dirs, &natives, "CP").unwrap();

        // macOS 선두 인자
        #[cfg(target_os = "macos")]
        assert_eq!(args[0], "-XstartOnFirstThread");

        assert!(args.contains(&"-Xms1024M".to_string()));
        assert!(args.contains(&"-Xmx4096M".to_string()));
        assert!(args.contains(&"-cp".to_string()));
        assert!(args.contains(&"CP".to_string()));
        // 매니페스트 jvm: natives/classpath 중복 스킵, brand 치환
        assert!(!args.iter().any(|a| a.contains("${natives_directory}")));
        assert!(args.contains(&"-Dminecraft.launcher.brand=HyeniMC".to_string()));
        // mainClass 뒤 게임 인자
        let mc_idx = args.iter().position(|a| a == "net.minecraft.client.main.Main").unwrap();
        assert!(args[mc_idx + 1..].contains(&"--username".to_string()));
        assert!(args[mc_idx + 1..].contains(&"혜니".to_string()));
        // quickPlay 쌍 제거
        assert!(!args.contains(&"--quickPlayMultiplayer".to_string()));
        assert!(!args.contains(&"srv:25565".to_string()));
        // feature 게이트 인자 제거
        assert!(!args.contains(&"--demo".to_string()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn spawn_streams_logs_and_reports_exit() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let fake_java = tmp.path().join("fake-java.sh");
        std::fs::write(&fake_java, "#!/bin/sh\necho line-one\necho err-one 1>&2\nexit 3\n").unwrap();
        std::fs::set_permissions(&fake_java, std::fs::Permissions::from_mode(0o755)).unwrap();

        let logs = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let logs2 = logs.clone();
        let (exit_tx, exit_rx) = tokio::sync::oneshot::channel::<Option<i32>>();

        let handle = spawn_game(
            &fake_java.display().to_string(),
            &[],
            tmp.path(),
            move |line| logs2.lock().unwrap().push(line),
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .await
        .unwrap();
        assert!(handle.pid.is_some());

        let code = tokio::time::timeout(std::time::Duration::from_secs(5), exit_rx)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(code, Some(3));
        // 로그 태스크 플러시 여유
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let got = logs.lock().unwrap().clone();
        assert!(got.contains(&"line-one".to_string()));
        assert!(got.iter().any(|l| l.contains("err-one")));
    }

    #[test]
    fn memory_min_over_max_is_corrected() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = fixture_dirs(&tmp);
        let mut spec = fixture_spec();
        spec.min_memory_mb = 8192;
        spec.max_memory_mb = 4096;
        let args = build_arguments(&fixture_detail(), &spec, &dirs, Path::new("n"), "CP").unwrap();
        assert!(args.contains(&"-Xms8192M".to_string()));
        assert!(args.contains(&"-Xmx8192M".to_string()));
    }
}
