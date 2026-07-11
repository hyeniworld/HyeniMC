//! 실DB의 profile_mods 캐시 읽기 스모크(in-place 호환 확인, 읽기 전용).
//! 실행: cargo run -p hyenimc-core --example read_mod_cache -- <profile_id>

fn main() {
    let profile_id = std::env::args().nth(1).unwrap_or_default();
    let data_dir = hyenimc_core::paths::legacy_data_dir().expect("data dir");
    let db_path = hyenimc_core::paths::database_path(&data_dir);
    let conn = hyenimc_core::open_database(&db_path).expect("open db");

    if profile_id.is_empty() {
        // 프로필별 캐시 개수 요약
        for p in hyenimc_core::list_profiles(&conn).unwrap() {
            let mods = hyenimc_core::mod_cache::list_cached_mods(&conn, &p.id).unwrap();
            println!("{} ({}): 캐시 {}개", p.name, p.id, mods.len());
        }
        return;
    }

    let mods = hyenimc_core::mod_cache::list_cached_mods(&conn, &profile_id).unwrap();
    let disabled = mods.iter().filter(|m| !m.enabled).count();
    let with_authors = mods.iter().filter(|m| !m.authors.is_empty()).count();
    let with_source = mods.iter().filter(|m| m.source_mod_id.is_some()).count();
    println!(
        "총 {}개 (비활성 {disabled}, authors {with_authors}, source_mod_id {with_source})",
        mods.len()
    );
    for m in mods.iter().take(4) {
        println!(
            "  {} | {} | mtime={} | enabled={} | authors={:?}",
            m.name, m.version, m.last_modified, m.enabled, m.authors
        );
    }
}
