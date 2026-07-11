//! 라이브러리/인자 OS rules 평가 (piston 버전 JSON).

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub action: String, // "allow" | "disallow"
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsRule {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub version: Option<String>, // 정규식 — 미사용(항상 매치 취급)
}

pub fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// piston rules의 arch 값은 "x86"(32비트)과 "arm64"만 등장한다.
/// 64비트 x86에서는 어느 쪽도 매치되지 않아야 32비트 전용 natives가 제외된다.
pub fn os_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_pointer_width = "32") {
        "x86"
    } else {
        "x64"
    }
}

/// 런처가 켜는 launch feature 상태 (Electron game-launcher `checkFeatures`와 동일).
/// - has_custom_resolution: 항상 켠다 → 버전 JSON의 `--width/--height` 인자 블록이 포함돼야
///   프로필/전역 해상도 설정이 실제로 반영된다.
/// - is_demo_user / has_quick_plays_support / is_quick_play_* : 미지원 → 배제.
fn feature_enabled(name: &str) -> bool {
    matches!(name, "has_custom_resolution")
}

fn rule_matches(rule: &Rule) -> bool {
    // feature 규칙: 요구하는 모든 feature가 런처 상태와 일치해야 매치.
    // (has_custom_resolution만 켜져 있으므로 해상도 인자는 포함, quickPlay/demo는 배제)
    if let Some(features) = &rule.features {
        for (name, &expected) in features {
            if feature_enabled(name) != expected {
                return false;
            }
        }
    }
    match &rule.os {
        None => true,
        Some(os) => {
            os.name.as_deref().map_or(true, |n| n == os_name())
                && os.arch.as_deref().map_or(true, |a| a == os_arch())
        }
    }
}

/// rules가 비면 허용. 마지막으로 매치된 rule의 action이 최종 결정 (piston 의미론).
pub fn rules_allow(rules: &[Rule]) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule_matches(rule) {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_rule_without_os_matches_all() {
        let rules: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow"}]"#).unwrap();
        assert!(rules_allow(&rules));
    }

    #[test]
    fn empty_rules_allow() {
        assert!(rules_allow(&[]));
    }

    #[test]
    fn disallow_for_current_os() {
        let json = format!(
            r#"[{{"action":"allow"}},{{"action":"disallow","os":{{"name":"{}"}}}}]"#,
            os_name()
        );
        let rules: Vec<Rule> = serde_json::from_str(&json).unwrap();
        assert!(!rules_allow(&rules));
    }

    #[test]
    fn allow_only_other_os_excludes_current() {
        let other = if os_name() == "osx" { "windows" } else { "osx" };
        let json = format!(r#"[{{"action":"allow","os":{{"name":"{other}"}}}}]"#);
        let rules: Vec<Rule> = serde_json::from_str(&json).unwrap();
        assert!(!rules_allow(&rules));
    }

    #[test]
    fn x86_arch_rule_does_not_match_64bit() {
        // 64비트(x64/arm64)에서 32비트 전용(natives-windows-x86) 규칙은 제외돼야 함
        let rules: Vec<Rule> =
            serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","arch":"x86"}}]"#)
                .unwrap();
        if os_name() == "windows" {
            assert_eq!(rules_allow(&rules), os_arch() == "x86");
        } else {
            assert!(!rules_allow(&rules));
        }
    }

    #[test]
    fn feature_rules_are_disallowed() {
        let rules: Vec<Rule> =
            serde_json::from_str(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#)
                .unwrap();
        assert!(!rules_allow(&rules));
    }

    #[test]
    fn custom_resolution_feature_is_allowed() {
        // 해상도 인자 블록: features.has_custom_resolution=true → 포함돼야 함
        let rules: Vec<Rule> = serde_json::from_str(
            r#"[{"action":"allow","features":{"has_custom_resolution":true}}]"#,
        )
        .unwrap();
        assert!(rules_allow(&rules));
    }

    #[test]
    fn quick_play_features_stay_disallowed() {
        for f in [
            "has_quick_plays_support",
            "is_quick_play_singleplayer",
            "is_quick_play_multiplayer",
            "is_quick_play_realms",
        ] {
            let json = format!(r#"[{{"action":"allow","features":{{"{f}":true}}}}]"#);
            let rules: Vec<Rule> = serde_json::from_str(&json).unwrap();
            assert!(!rules_allow(&rules), "{f} 는 배제돼야 함");
        }
    }
}
