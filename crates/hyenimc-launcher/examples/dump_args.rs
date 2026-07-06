//! 전체 리뷰 2차 ① — 실인스턴스의 버전 json으로 인자 조립을 실행해
//! 미해석 플레이스홀더(${...})와 구조를 검사한다 (읽기 전용).
//!
//! 실행: cargo run -p hyenimc-launcher --example dump_args -- <instance_dir> <version_id>

use hyenimc_launcher::install::{load_version_detail, GameDirs};
use hyenimc_launcher::launch::{build_arguments, build_classpath, LaunchSpec};

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(instance), Some(version_id)) = (args.next(), args.next()) else {
        eprintln!("usage: dump_args <instance_dir> <version_id>");
        std::process::exit(2);
    };
    let instance_dir = std::path::PathBuf::from(&instance);
    let user_data = instance_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("instances/<id> 구조 아님")
        .to_path_buf();
    let dirs = GameDirs {
        instance_dir: instance_dir.clone(),
        shared_libraries: user_data.join("shared/libraries"),
        shared_assets: user_data.join("shared/assets"),
    };

    let detail = load_version_detail(&dirs, &version_id).expect("버전 json 로드/병합 실패");
    println!(
        "id={} inherits={:?} mainClass={:?} libs={}",
        detail.id,
        detail.inherits_from,
        detail.main_class,
        detail.libraries.len()
    );

    let (classpath, missing) = build_classpath(&detail, &dirs);
    println!("classpath entries={} missing_libs={}", classpath.split(':').count(), missing.len());
    for m in &missing {
        println!("  missing: {m}");
    }

    let spec = LaunchSpec {
        profile_id: "review".into(),
        version_id: version_id.clone(),
        java_path: "java".into(),
        min_memory_mb: 1024,
        max_memory_mb: 4096,
        username: "Reviewer".into(),
        uuid: "00000000-0000-0000-0000-000000000000".into(),
        access_token: None,
        user_type: None,
        resolution: None,
        fullscreen: false,
    };
    let natives = dirs.version_dir(&version_id).join("natives");
    let built = build_arguments(&detail, &spec, &dirs, &natives, &classpath).expect("인자 조립 실패");

    let unresolved: Vec<&String> = built.iter().filter(|a| a.contains("${")).collect();
    println!("args={} unresolved_placeholders={}", built.len(), unresolved.len());
    for u in &unresolved {
        println!("  UNRESOLVED: {u}");
    }
    // 클라이언트 jar 포함 여부 (G8 검증)
    let has_child_jar = classpath.contains(&format!("{version_id}.jar"));
    println!("classpath_has_child_jar={has_child_jar}");
    println!("--- 처음 12개 인자 ---");
    for a in built.iter().take(12) {
        println!("  {a}");
    }
    println!("--- mainClass 이후 게임 인자 ---");
    if let Some(pos) = built.iter().position(|a| Some(a.as_str()) == detail.main_class.as_deref()) {
        for a in built.iter().skip(pos) {
            println!("  {a}");
        }
    }
    if !unresolved.is_empty() {
        std::process::exit(1);
    }
}
