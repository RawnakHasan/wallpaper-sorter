//! Runs every row of spec/cases.csv through the Rust matcher with spec/tags.starter.toml.
//! The CSV was produced by spec/ref_matcher.py, so this proves the two agree.

use sorter_core::{classify, Config};
use std::path::PathBuf;

fn spec_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec")
}

#[test]
fn cases_csv_matches_reference() {
    let dir = spec_dir();
    let toml = std::fs::read_to_string(dir.join("tags.starter.toml")).expect("read tags.starter.toml");
    let cfg = Config::from_toml(&toml).expect("parse tags.starter.toml");

    let mut rdr = csv::Reader::from_path(dir.join("cases.csv")).expect("open cases.csv");
    let headers = rdr.headers().unwrap().clone();
    let col = |name: &str| headers.iter().position(|h| h == name).unwrap_or_else(|| panic!("missing column {name}"));
    let (c_input, c_dest, c_rule, c_matched) = (col("input"), col("expected_dest"), col("rule"), col("matched"));

    let mut total = 0;
    let mut bad = Vec::new();
    for rec in rdr.records() {
        let rec = rec.unwrap();
        total += 1;
        let d = classify(&rec[c_input], &cfg);
        let got = (d.dest.label(), d.rule.label().to_string(), d.matched.join(";"));
        let want = (rec[c_dest].to_string(), rec[c_rule].to_string(), rec[c_matched].to_string());
        if got != want {
            bad.push(format!("{}\n   want {:?}\n   got  {:?}", &rec[c_input], want, got));
        }
    }
    assert!(total >= 300, "expected at least 300 cases, found {total}");
    assert!(bad.is_empty(), "{} of {} cases differ:\n{}", bad.len(), total, bad.join("\n"));
}

#[test]
fn prefix_defaults() {
    let dir = spec_dir();
    let cfg = Config::from_toml(&std::fs::read_to_string(dir.join("tags.starter.toml")).unwrap()).unwrap();
    assert_eq!(cfg.prefix_for("Wuthering-Waves"), "Wuthering Waves");
    assert_eq!(cfg.prefix_for("Wuthering-Waves/Chisa"), "Chisa");
    assert_eq!(cfg.prefix_for("Harry Potter"), "Harry Potter");
}
