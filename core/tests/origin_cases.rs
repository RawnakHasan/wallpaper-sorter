//! Runs spec/origins.csv through parse_source. The expected values in the CSV are hand-written.

use sorter_core::{parse_source, Site, Source};
use std::path::PathBuf;

#[test]
fn origins_csv() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/origins.csv");
    let mut rdr = csv::Reader::from_path(path).expect("open origins.csv");
    let h = rdr.headers().unwrap().clone();
    let col = |n: &str| {
        h.iter()
            .position(|x| x == n)
            .unwrap_or_else(|| panic!("missing column {n}"))
    };
    let (c_case, c_in, c_parent, c_site, c_id, c_page, c_artist, c_aid, c_url) = (
        col("case"),
        col("input"),
        col("parent"),
        col("site"),
        col("id"),
        col("page"),
        col("artist"),
        col("artist_id"),
        col("url"),
    );
    let mut total = 0;
    let mut bad = Vec::new();
    for rec in rdr.records() {
        let rec = rec.unwrap();
        total += 1;
        let s = if rec[c_case].starts_with("manual ") {
            Site::from_label(&rec[c_site])
                .map_or_else(Source::unknown, |site| Source::manual(site, &rec[c_in]))
        } else {
            parse_source(&rec[c_in], &rec[c_parent])
        };
        let got = (
            s.site.label().to_string(),
            s.id.clone(),
            s.page.map(|p| p.to_string()).unwrap_or_default(),
            s.artist.clone().unwrap_or_default(),
            s.artist_id.clone().unwrap_or_default(),
            s.url.clone(),
        );
        let want = (
            rec[c_site].to_string(),
            rec[c_id].to_string(),
            rec[c_page].to_string(),
            rec[c_artist].to_string(),
            rec[c_aid].to_string(),
            rec[c_url].to_string(),
        );
        if got != want {
            bad.push(format!(
                "{}\n   want {:?}\n   got  {:?}",
                &rec[c_case], want, got
            ));
        }
    }
    assert!(total >= 20, "expected at least 20 rows, found {total}");
    assert!(
        bad.is_empty(),
        "{} of {} rows differ:\n{}",
        bad.len(),
        total,
        bad.join("\n")
    );
}
