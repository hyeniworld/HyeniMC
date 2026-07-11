//! 실제 기존 Electron 판 DB를 읽는 in-place 호환 실증 (M0 스파이크용).
//!
//! 실행: cargo run -p hyenimc-core --example read_real_db

fn main() {
    let Some(data_dir) = hyenimc_core::paths::legacy_data_dir() else {
        eprintln!("legacy data dir을 결정할 수 없음");
        std::process::exit(1);
    };
    let db_path = hyenimc_core::paths::database_path(&data_dir);
    println!("DB: {}", db_path.display());

    let conn = match hyenimc_core::open_database(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("열기 실패: {e}");
            std::process::exit(1);
        }
    };

    let version = hyenimc_core::db::schema_version(&conn).expect("schema_version");
    println!("schema_version: {version}");

    let profiles = hyenimc_core::list_profiles(&conn).expect("profiles");
    println!("profiles: {}개", profiles.len());
    for p in &profiles {
        println!(
            "  - {} ({} / {} {}) favorite={}",
            p.name,
            p.game_version,
            p.loader_type,
            p.loader_version.as_deref().unwrap_or("-"),
            p.favorite
        );
    }

    let settings = hyenimc_core::settings::get_settings(&conn).expect("settings");
    println!(
        "settings: java.memory_max={} download.max_parallel={} resolution={}x{}",
        settings.java.memory_max,
        settings.download.max_parallel,
        settings.resolution.width,
        settings.resolution.height
    );

    if let Some(p) = profiles.first() {
        let stats = hyenimc_core::stats::get_stats(&conn, &p.id).expect("stats");
        println!(
            "stats[{}]: launches={} play_time={}s crashes={}",
            p.name, stats.launch_count, stats.total_play_time, stats.crash_count
        );
    }

    // 계정 토큰 복호화 호환 검증 (M3) — 토큰 값은 절대 출력하지 않는다
    let accounts = hyenimc_core::account::list_accounts(&conn).expect("accounts");
    println!("accounts: {}개", accounts.len());
    match hyenimc_core::crypto::load_or_create_encryption_key(&data_dir) {
        Ok(key) => {
            for a in &accounts {
                match hyenimc_core::account::get_tokens(&conn, &key, &a.id) {
                    Ok(Some(t)) => println!(
                        "  - {} ({}) 복호화 OK: access_token {}자, refresh {}자, expires_at={}",
                        a.name,
                        a.account_type,
                        t.access_token.len(),
                        t.refresh_token.len(),
                        t.expires_at
                    ),
                    Ok(None) => println!("  - {} ({}) 토큰 없음", a.name, a.account_type),
                    Err(e) => println!("  - {} 복호화 실패: {e}", a.name),
                }
            }
        }
        Err(e) => println!("  .key 로드 실패: {e}"),
    }
}
