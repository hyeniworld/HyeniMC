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
}
