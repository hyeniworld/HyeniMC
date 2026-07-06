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

pub fn os_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86"
    }
}

fn rule_matches(rule: &Rule) -> bool {
    // feature 조건은 전부 미사용 → feature가 걸린 rule은 매치 안 함
    if rule.features.as_ref().is_some_and(|f| !f.is_empty()) {
        return false;
    }
    match &rule.os {
        None => true,
        Some(os) => {
            os.name.as_deref().map_or(true, |n| n == os_name())
                && os.arch.as_deref().map_or(true, |a| a == os_arch() || a == "x86")
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
    fn feature_rules_are_disallowed() {
        let rules: Vec<Rule> =
            serde_json::from_str(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#)
                .unwrap();
        assert!(!rules_allow(&rules));
    }
}
