//! Runs spec/plan_cases.toml through build_plan. The expected actions are hand-written.

use serde::Deserialize;
use sorter_core::{build_plan_with, Config, GapMode, Incoming, Library, PlanOptions};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

#[derive(Deserialize)]
struct Cases {
    case: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    #[serde(default)]
    gap_mode: Option<GapMode>,
    #[serde(default)]
    assign_to: Option<String>,
    #[serde(default)]
    library: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    hashes: HashMap<String, String>,
    incoming: Vec<String>,
    #[serde(default)]
    incoming_hashes: HashMap<String, String>,
    #[serde(default)]
    incoming_hints: HashMap<String, Vec<String>>,
    expect: Vec<String>,
}

#[test]
fn plan_cases_toml() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec");
    let base = Config::from_toml(&std::fs::read_to_string(dir.join("tags.starter.toml")).unwrap())
        .unwrap();
    let cases: Cases =
        toml::from_str(&std::fs::read_to_string(dir.join("plan_cases.toml")).unwrap()).unwrap();

    let mut bad = Vec::new();
    for c in &cases.case {
        let mut cfg = base.clone();
        if let Some(m) = c.gap_mode {
            cfg.settings.gap_mode = m;
        }
        let library = Library {
            folders: c.library.clone(),
            hashes: c.hashes.clone(),
        };
        let incoming: Vec<Incoming> = c
            .incoming
            .iter()
            .map(|p| Incoming {
                path: p.clone(),
                library_path: None,
                hash: c.incoming_hashes.get(p).cloned(),
                hints: c.incoming_hints.get(p).cloned().unwrap_or_default(),
            })
            .collect();
        let opts = PlanOptions {
            forced_dest: c.assign_to.clone(),
            skip_duplicate_check: false,
        };
        let got = build_plan_with(&cfg, &library, &incoming, &opts).describe();
        if got != c.expect {
            bad.push(format!(
                "{}\n   want {:#?}\n   got  {:#?}",
                c.name, c.expect, got
            ));
        }
    }
    assert!(
        cases.case.len() >= 27,
        "expected at least 27 cases, found {}",
        cases.case.len()
    );
    assert!(
        bad.is_empty(),
        "{} of {} cases differ:\n{}",
        bad.len(),
        cases.case.len(),
        bad.join("\n")
    );
}
