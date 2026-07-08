//! 크래시 자동 진단 — Electron `crash-analyzer.ts` + `game-launcher.analyzeProcessOutput` 포팅.
//!
//! 게임이 비정상 종료(exit code != 0)하면:
//! 1. 최신 crash-report(txt)를 패턴 분석해 원인 유형별 제목/메시지/해결책을 만들고,
//! 2. crash-report가 없으면 캡처된 stdout/stderr 버퍼를 패턴 분석해 폴백 진단하여,
//! `show-error-dialog` 이벤트로 렌더러 ErrorDialog에 표시한다.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

/// 진단 결과 한 가지 해결책. `action`이 있으면 다이얼로그 버튼으로 노출된다.
struct Fix {
    title: String,
    action: Option<String>,
}

struct CrashAnalysis {
    title: String,
    message: String,
    fixes: Vec<Fix>,
    log_excerpt: String,
}

/// 게임 비정상 종료 시 진단 후 `show-error-dialog` emit.
pub fn report_crash(
    app: &AppHandle,
    game_dir: &Path,
    logs: &[String],
    code: Option<i32>,
    elapsed_ms: u128,
) {
    let payload = match find_latest_crash_log(game_dir).and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(log) => analysis_to_dialog(analyze_crash_log(&log)),
        None => process_output_dialog(logs, code, elapsed_ms),
    };
    let _ = app.emit("show-error-dialog", payload);
}

/// gameDir/crash-reports 의 최신 crash-*.txt (파일명 내림차순 = 시간 최신).
fn find_latest_crash_log(game_dir: &Path) -> Option<PathBuf> {
    let dir = game_dir.join("crash-reports");
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with("crash-") && n.ends_with(".txt"))
        .collect();
    if files.is_empty() {
        return None;
    }
    files.sort();
    files.pop().map(|name| dir.join(name))
}

// ── crash-report 분석 ────────────────────────────────────

fn analyze_crash_log(log: &str) -> CrashAnalysis {
    if is_memory_crash(log) {
        memory_crash(log)
    } else if is_mod_conflict(log) {
        mod_conflict(log)
    } else if is_graphics_error(log) {
        graphics_error(log)
    } else if is_file_corruption(log) {
        file_corruption(log)
    } else {
        unknown_crash(log)
    }
}

fn is_memory_crash(log: &str) -> bool {
    log.contains("OutOfMemoryError") || log.contains("Java heap space") || log.contains("GC overhead limit")
}

fn is_mod_conflict(log: &str) -> bool {
    let lower = log.to_lowercase();
    log.contains("ModLoadingException")
        || log.contains("Duplicate mod")
        || log.contains("mod conflict")
        || (log.contains("NoClassDefFoundError") && lower.contains("mod"))
        || (log.contains("ClassNotFoundException") && lower.contains("mod"))
}

fn is_graphics_error(log: &str) -> bool {
    log.contains("GLException") || log.contains("OpenGL error") || log.contains("GPU error") || log.contains("graphics driver")
}

fn is_file_corruption(log: &str) -> bool {
    log.contains("ZipException") || log.contains("invalid LOC header") || log.contains("Corrupted")
}

fn memory_crash(log: &str) -> CrashAnalysis {
    let current = extract_memory_setting(log);
    let suggested = std::cmp::min(((current as f64) * 1.5).ceil() as i64, 8192);
    CrashAnalysis {
        title: "메모리 부족으로 게임이 종료되었습니다".into(),
        message: format!("현재 {current}MB가 할당되어 있지만 부족합니다."),
        fixes: vec![
            Fix { title: format!("메모리를 {suggested}MB로 증가"), action: Some("increaseMemory".into()) },
            Fix { title: "일부 모드 비활성화".into(), action: None },
            Fix { title: "백그라운드 프로그램 종료".into(), action: None },
        ],
        log_excerpt: excerpt(log),
    }
}

fn mod_conflict(log: &str) -> CrashAnalysis {
    let mods = extract_problematic_mods(log);
    let message = if mods.is_empty() {
        "모드 간 충돌이 발생했습니다.".to_string()
    } else {
        format!("{} 모드에서 문제가 발생했습니다.", mods.join(", "))
    };
    let disable_title = if mods.is_empty() {
        "최근에 추가한 모드를 비활성화해보세요.".to_string()
    } else {
        format!("{} 모드를 비활성화합니다.", mods.join(", "))
    };
    CrashAnalysis {
        title: "모드 충돌로 게임이 종료되었습니다".into(),
        message,
        fixes: vec![
            Fix { title: disable_title, action: None },
            Fix { title: "모드 업데이트".into(), action: None },
        ],
        log_excerpt: excerpt(log),
    }
}

fn graphics_error(log: &str) -> CrashAnalysis {
    CrashAnalysis {
        title: "그래픽 오류로 게임이 종료되었습니다".into(),
        message: "GPU 드라이버 또는 그래픽 설정에 문제가 있습니다.".into(),
        fixes: vec![
            Fix { title: "GPU 드라이버 업데이트".into(), action: None },
            Fix { title: "그래픽 설정 낮추기".into(), action: None },
        ],
        log_excerpt: excerpt(log),
    }
}

fn file_corruption(log: &str) -> CrashAnalysis {
    CrashAnalysis {
        title: "파일 손상으로 게임이 종료되었습니다".into(),
        message: "게임 파일 또는 모드 파일이 손상되었습니다.".into(),
        fixes: vec![
            Fix { title: "프로필 재생성".into(), action: None },
            Fix { title: "모드 재다운로드".into(), action: None },
        ],
        log_excerpt: excerpt(log),
    }
}

fn unknown_crash(log: &str) -> CrashAnalysis {
    CrashAnalysis {
        title: "알 수 없는 원인으로 게임이 종료되었습니다".into(),
        message: "크래시 로그를 확인하여 자세한 정보를 파악하세요.".into(),
        fixes: vec![
            Fix { title: "크래시 로그 확인".into(), action: None },
            Fix { title: "게임 재시작".into(), action: None },
        ],
        log_excerpt: excerpt(log),
    }
}

/// -Xmx4G / -Xmx4096M 에서 MB 값 추출 (Electron과 동일: G→*1024, 그 외/미발견 → 2048).
fn extract_memory_setting(log: &str) -> i64 {
    if let Some(idx) = log.find("-Xmx") {
        let rest = &log[idx + 4..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(val) = digits.parse::<i64>() {
            return match rest[digits.len()..].chars().next() {
                Some('G') => val * 1024,
                Some('M') => val,
                _ => 2048,
            };
        }
    }
    2048
}

/// 스택트레이스 `at <root>.` 에서 모드로 추정되는 최상위 패키지명 상위 3개(java/com/net/org 제외).
fn extract_problematic_mods(log: &str) -> Vec<String> {
    let common = ["java", "com", "net", "org"];
    let mut seen = std::collections::HashSet::new();
    let mut mods = Vec::new();
    for line in log.lines() {
        let Some(rest) = line.trim_start().strip_prefix("at ").map(str::trim_start) else {
            continue;
        };
        let ident: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        // 식별자 첫 글자는 알파/밑줄, 바로 뒤는 '.'(패키지 경로)
        let first_ok = ident.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false);
        if !first_ok || rest[ident.len()..].chars().next() != Some('.') {
            continue;
        }
        if common.contains(&ident.to_lowercase().as_str()) {
            continue;
        }
        if seen.insert(ident.clone()) {
            mods.push(ident);
            if mods.len() >= 3 {
                break;
            }
        }
    }
    mods
}

fn excerpt(log: &str) -> String {
    log.chars().take(2000).collect()
}

fn analysis_to_dialog(a: CrashAnalysis) -> serde_json::Value {
    let suggestions: Vec<&str> = a.fixes.iter().map(|f| f.title.as_str()).collect();
    let actions: Vec<serde_json::Value> = a
        .fixes
        .iter()
        .filter_map(|f| {
            f.action.as_ref().map(|act| {
                serde_json::json!({ "label": f.title, "type": "primary", "action": act })
            })
        })
        .collect();
    serde_json::json!({
        "type": "error",
        "title": a.title,
        "message": a.message,
        "details": a.log_excerpt,
        "suggestions": suggestions,
        "actions": actions,
    })
}

// ── crash-report 없을 때: 캡처 출력 폴백 분석 ─────────────

fn process_output_dialog(output: &[String], code: Option<i32>, elapsed_ms: u128) -> serde_json::Value {
    let (title, message, suggestions) = analyze_process_output(output, code, elapsed_ms);
    let details = if output.is_empty() {
        let code_s = code.map(|c| c.to_string()).unwrap_or_else(|| "null".into());
        format!("프로세스가 {elapsed_ms}ms 만에 종료됨 (exit code: {code_s})\n\n출력이 캡처되지 않았습니다.")
    } else {
        let start = output.len().saturating_sub(100);
        output[start..].join("\n")
    };
    serde_json::json!({
        "type": "error",
        "title": title,
        "message": message,
        "details": details,
        "suggestions": suggestions,
    })
}

/// (패턴, 제목, 메시지, 해결책) — Java → 그래픽 → 모드 순으로 첫 매치 반환 (Electron 동일 순서).
const OUTPUT_PATTERNS: &[(&str, &str, &str, &[&str])] = &[
    ("unsupportedclassversionerror", "Java 버전 호환성 문제", "현재 Java 버전이 이 마인크래프트 버전과 호환되지 않습니다.", &["프로필 설정에서 Java 버전을 변경해보세요", "Java 21 이상을 설치해보세요"]),
    ("java.lang.noclassdeffounderror", "클래스를 찾을 수 없음", "필요한 라이브러리나 클래스가 누락되었습니다.", &["게임 파일을 다시 다운로드해보세요", "모드 충돌 여부를 확인해보세요"]),
    ("java.lang.outofmemoryerror", "메모리 부족", "Java 힙 메모리가 부족합니다.", &["프로필 설정에서 최대 메모리를 늘려보세요", "다른 프로그램을 종료해보세요"]),
    ("could not create the java virtual machine", "JVM 생성 실패", "Java Virtual Machine을 생성할 수 없습니다.", &["할당된 메모리가 시스템 메모리보다 큰지 확인해보세요", "Java를 다시 설치해보세요"]),
    ("error: could not find or load main class", "메인 클래스를 찾을 수 없음", "마인크래프트 실행 파일이 손상되었거나 누락되었습니다.", &["게임 파일을 다시 다운로드해보세요", "버전 파일을 확인해보세요"]),
    ("access is denied", "접근 거부됨", "파일이나 폴더에 대한 접근이 거부되었습니다.", &["관리자 권한으로 런처를 실행해보세요", "안티바이러스가 차단하는지 확인해보세요"]),
    ("unable to access jarfile", "JAR 파일 접근 불가", "마인크래프트 JAR 파일을 찾을 수 없거나 접근할 수 없습니다.", &["게임 파일을 다시 다운로드해보세요", "파일 경로에 특수문자가 있는지 확인해보세요"]),
    ("lwjgl", "LWJGL 에러", "그래픽 라이브러리에서 문제가 발생했습니다.", &["그래픽 드라이버를 업데이트해보세요", "Java 버전을 변경해보세요"]),
    ("opengl", "OpenGL 에러", "OpenGL 그래픽 에러가 발생했습니다.", &["그래픽 드라이버를 업데이트해보세요", "호환성 모드로 실행해보세요"]),
    ("mixin", "Mixin 에러", "모드 로딩 중 에러가 발생했습니다.", &["호환되지 않는 모드를 제거해보세요", "모드 버전을 확인해보세요"]),
    ("fabric", "Fabric 에러", "Fabric 모드 로더에서 에러가 발생했습니다.", &["Fabric 버전을 업데이트해보세요", "모드 호환성을 확인해보세요"]),
    ("forge", "Forge 에러", "Forge 모드 로더에서 에러가 발생했습니다.", &["Forge 버전을 업데이트해보세요", "모드 호환성을 확인해보세요"]),
];

fn analyze_process_output(output: &[String], code: Option<i32>, elapsed_ms: u128) -> (String, String, Vec<String>) {
    let text = output.join("\n").to_lowercase();
    for (pat, title, msg, sugg) in OUTPUT_PATTERNS {
        if text.contains(pat) {
            return ((*title).into(), (*msg).into(), sugg.iter().map(|s| s.to_string()).collect());
        }
    }

    // error/exception/failed 를 포함하는 첫 라인
    if let Some(first) = output.iter().find(|l| {
        let ll = l.to_lowercase();
        ll.contains("error") || ll.contains("exception") || ll.contains("failed")
    }) {
        let msg = first.replace("[STDOUT] ", "").replace("[STDERR] ", "");
        return (
            "게임 실행 오류".into(),
            msg,
            vec![
                "로그 내용을 확인하여 원인을 파악해보세요".into(),
                "게임 파일을 다시 다운로드해보세요".into(),
                "모드나 리소스팩을 제거하고 다시 시도해보세요".into(),
            ],
        );
    }

    let code_s = code.map(|c| c.to_string()).unwrap_or_else(|| "null".into());
    if elapsed_ms < 10_000 {
        if output.is_empty() {
            return (
                "게임이 즉시 종료됨".into(),
                format!("프로세스가 {elapsed_ms}ms 만에 종료되었습니다. (exit code: {code_s})"),
                vec![
                    "Java 경로가 올바른지 확인해보세요".into(),
                    "Java 버전이 이 마인크래프트 버전과 호환되는지 확인해보세요".into(),
                    "게임 디렉토리 경로에 특수문자가 있는지 확인해보세요".into(),
                    "안티바이러스 프로그램이 차단하는지 확인해보세요".into(),
                ],
            );
        }
        return (
            "게임이 빠르게 종료됨".into(),
            format!("프로세스가 {:.1}초 만에 종료되었습니다. (exit code: {code_s})", elapsed_ms as f64 / 1000.0),
            vec![
                "아래 로그 내용을 확인해보세요".into(),
                "Java 버전이 호환되는지 확인해보세요".into(),
                "모드 충돌 여부를 확인해보세요".into(),
            ],
        );
    }

    (
        "알 수 없는 오류".into(),
        format!("게임이 비정상 종료되었습니다. (exit code: {code_s})"),
        vec![
            "로그 내용을 확인해보세요".into(),
            "마인크래프트 커뮤니티에서 도움을 구해보세요".into(),
            "게임 파일을 다시 다운로드해보세요".into(),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_memory_crash_and_suggests_increase() {
        let log = "java.lang.OutOfMemoryError: Java heap space\n-Xmx2G ...";
        let a = analyze_crash_log(log);
        assert!(a.title.contains("메모리"));
        // 2G=2048 → 1.5배 = 3072
        assert!(a.fixes.iter().any(|f| f.title.contains("3072") && f.action.as_deref() == Some("increaseMemory")));
    }

    #[test]
    fn memory_setting_parsing() {
        assert_eq!(extract_memory_setting("-Xmx4G"), 4096);
        assert_eq!(extract_memory_setting("-Xmx4096M"), 4096);
        assert_eq!(extract_memory_setting("no xmx here"), 2048);
    }

    #[test]
    fn extracts_mod_names_excluding_stdlib() {
        let log = "\tat net.minecraft.Foo\n\tat sodium.mixin.Bar\n\tat java.lang.Baz\n\tat sodium.mixin.Qux";
        let mods = extract_problematic_mods(log);
        assert_eq!(mods, vec!["sodium".to_string()]); // net/java 제외, sodium 중복 제거
    }

    #[test]
    fn mod_conflict_detection() {
        assert!(is_mod_conflict("Caused by: net.fabricmc.loader.impl.ModLoadingException: ..."));
        assert!(is_mod_conflict("java.lang.NoClassDefFoundError: some/mod/Class"));
        assert!(!is_mod_conflict("java.lang.NullPointerException"));
    }

    #[test]
    fn process_output_java_version_pattern() {
        let out = vec!["[STDERR] java.lang.UnsupportedClassVersionError: bad".to_string()];
        let (title, _, sugg) = analyze_process_output(&out, Some(1), 3000);
        assert!(title.contains("Java 버전"));
        assert!(!sugg.is_empty());
    }

    #[test]
    fn process_output_quick_exit_no_output() {
        let (title, _, _) = analyze_process_output(&[], Some(1), 500);
        assert_eq!(title, "게임이 즉시 종료됨");
    }
}
