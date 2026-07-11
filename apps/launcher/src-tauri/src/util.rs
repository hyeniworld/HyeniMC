//! 공용 유틸 — 커맨드 로깅 헬퍼 등.

/// 커맨드 실패를 로그파일에 남기면서 렌더러용 String으로 변환하는 map_err 헬퍼.
///
/// 기존 `.map_err(|e| e.to_string())?`는 렌더러 토스트로만 에러가 가고 로그파일엔
/// 아무것도 안 남아 사후 진단이 불가능했다. 이 헬퍼로 바꾸면 실패 시 `[ctx] <원인>`이
/// 로그파일(tauri-plugin-log)에 error 레벨로 남는다.
///
/// 사용: `something().map_err(cmd_err("profile_create"))?`
pub(crate) fn cmd_err<E: std::fmt::Display>(ctx: &'static str) -> impl FnOnce(E) -> String {
    move |e| {
        log::error!("[{ctx}] {e}");
        e.to_string()
    }
}
