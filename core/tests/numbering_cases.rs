//! Runs spec/numbering.csv through plan_new_file. The expected values in the CSV are hand-written.

use sorter_core::{plan_new_file, GapMode, Settings};
use std::path::PathBuf;

fn mode(s: &str) -> GapMode {
    match s {
        "keep" => GapMode::Keep,
        "lowest" => GapMode::LowestFree,
        "last" => GapMode::LastIntoGap,
        "renumber" => GapMode::Renumber,
        other => panic!("unknown mode {other}"),
    }
}

#[test]
fn numbering_csv() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/numbering.csv");
    let exts = Settings::default().image_extensions;
    let mut rdr = csv::Reader::from_path(path).expect("open numbering.csv");
    let h = rdr.headers().unwrap().clone();
    let col = |n: &str| {
        h.iter()
            .position(|x| x == n)
            .unwrap_or_else(|| panic!("missing column {n}"))
    };
    let (c_case, c_prefix, c_existing, c_mode, c_ext, c_renames, c_name, c_err) = (
        col("case"),
        col("prefix"),
        col("existing"),
        col("mode"),
        col("ext"),
        col("renames"),
        col("new_name"),
        col("error"),
    );

    let mut total = 0;
    let mut bad = Vec::new();
    for rec in rdr.records() {
        let rec = rec.unwrap();
        total += 1;
        let existing: Vec<String> = if rec[c_existing].is_empty() {
            vec![]
        } else {
            rec[c_existing].split('|').map(|s| s.to_string()).collect()
        };
        let got = match plan_new_file(
            &existing,
            &rec[c_prefix],
            &rec[c_ext],
            mode(&rec[c_mode]),
            &exts,
        ) {
            Ok(p) => (
                p.renames
                    .iter()
                    .map(|r| format!("{}>{}", r.from, r.to))
                    .collect::<Vec<_>>()
                    .join(";"),
                p.name,
                String::new(),
            ),
            Err(e) => (String::new(), String::new(), e.to_string()),
        };
        let want = (
            rec[c_renames].to_string(),
            rec[c_name].to_string(),
            rec[c_err].to_string(),
        );
        if got != want {
            bad.push(format!(
                "{}\n   want {:?}\n   got  {:?}",
                &rec[c_case], want, got
            ));
        }
    }
    assert!(total >= 25, "expected at least 25 rows, found {total}");
    assert!(
        bad.is_empty(),
        "{} of {} rows differ:\n{}",
        bad.len(),
        total,
        bad.join("\n")
    );
}

#[test]
fn gaps_and_next_number() {
    use sorter_core::numbering::{gaps, next_number};
    let exts = Settings::default().image_extensions;
    let files: Vec<String> = ["Chisa 1.jpg", "Chisa 4.png", "Chisa 6.jpg", "notes.txt"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(gaps(&files, "Chisa", &exts), vec![2, 3, 5]);
    assert_eq!(next_number(&files, "Chisa", &exts), 7);
}
