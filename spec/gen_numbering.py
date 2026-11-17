"""Writes numbering.csv. Expected values are typed by hand here, not computed:
this table is the spec for core/src/numbering.rs."""
import csv

def names(prefix, nums, ext="jpg"):
    return "|".join(f"{prefix} {n}.{ext}" for n in nums)

def rn(*pairs):
    return ";".join(f"{a}>{b}" for a, b in pairs)

C = "Chisa"
design = [n for n in range(1, 22) if n not in (5, 11)]      # the 19 Chisa images: 1 to 21 minus 5 and 11
shift = [(f"Chisa {n}.jpg", f"Chisa {m}.jpg") for n, m in zip([6,7,8,9,10]+list(range(12,22)), [5,6,7,8,9]+list(range(10,20)))]

# case, prefix, existing, mode, new ext, expected renames, expected new name, expected error
ROWS = [
 ("empty folder",               C, "", "keep", "png", "", "Chisa 1.png", ""),
 ("two files",                  C, "Chisa 1.jpg|Chisa 2.png", "keep", "png", "", "Chisa 3.png", ""),
 ("gaps are kept",              C, "Chisa 1.jpg|Chisa 3.jpg|Chisa 7.png", "keep", "jpg", "", "Chisa 8.jpg", ""),
 ("other names are ignored",    C, "Chisa 1.jpg|Kuchiba.Chisa.full.4511113.png|wallhaven-1q23yg.jpg|Chisa 2", "keep", "png", "", "Chisa 2.png", ""),
 ("zero padded counts",         C, "Chisa 05.jpg|Chisa 3.png", "keep", "png", "", "Chisa 6.png", ""),
 ("prefix ignores case",        C, "chisa 4.jpg", "keep", "png", "", "Chisa 5.png", ""),
 ("other prefix is ignored",    C, "Aemeath 9.jpg|Chisa 2.jpg", "keep", "png", "", "Chisa 3.png", ""),
 ("extra words are ignored",    C, "Chisa 2 copy.jpg|Chisa 2.jpg", "keep", "png", "", "Chisa 3.png", ""),
 ("non-image extension",        C, "Chisa 9.txt|Chisa 1.jpg", "keep", "png", "", "Chisa 2.png", ""),
 ("partial download name",      C, "Chisa 9.png.part|Chisa 1.jpg", "keep", "png", "", "Chisa 2.png", ""),
 ("same number two extensions", C, "Chisa 5.jpg|Chisa 5.png", "keep", "png", "", "Chisa 6.png", ""),
 ("prefix with a space",        "Wuthering Waves", "Wuthering Waves 52.jpg|Wuthering Waves 3.png", "keep", "png", "", "Wuthering Waves 53.png", ""),
 ("prefix longer than a name",  "Wuthering Waves", "Wuthering 4.jpg", "keep", "png", "", "Wuthering Waves 1.png", ""),
 ("big number is fine",         C, "Chisa 99999.jpg", "keep", "png", "", "Chisa 100000.png", ""),
 ("design example, keep",       C, names(C, design), "keep", "png", "", "Chisa 22.png", ""),
 ("lowest free takes a gap",    C, "Chisa 1.jpg|Chisa 2.jpg|Chisa 4.jpg", "lowest", "png", "", "Chisa 3.png", ""),
 ("lowest free, no gaps",       C, "Chisa 1.jpg|Chisa 2.jpg", "lowest", "png", "", "Chisa 3.png", ""),
 ("lowest free, empty",         C, "", "lowest", "png", "", "Chisa 1.png", ""),
 ("design example, lowest",     C, names(C, design), "lowest", "png", "", "Chisa 5.png", ""),
 ("last into gap, one gap",     C, "Chisa 1.jpg|Chisa 3.jpg|Chisa 4.jpg", "last", "png", rn(("Chisa 4.jpg","Chisa 2.jpg")), "Chisa 4.png", ""),
 ("last into gap keeps ext",    C, "Chisa 1.png|Chisa 3.jpg", "last", "webp", rn(("Chisa 3.jpg","Chisa 2.jpg")), "Chisa 3.webp", ""),
 ("last into gap, no gaps",     C, "Chisa 1.jpg|Chisa 2.jpg", "last", "png", "", "Chisa 3.png", ""),
 ("last into gap, gap at 1",    C, "Chisa 2.jpg|Chisa 3.jpg", "last", "png", rn(("Chisa 3.jpg","Chisa 1.jpg")), "Chisa 3.png", ""),
 ("design example, last",       C, names(C, design), "last", "png", rn(("Chisa 21.jpg","Chisa 5.jpg"),("Chisa 20.jpg","Chisa 11.jpg")), "Chisa 20.png", ""),
 ("renumber, no gaps",          C, "Chisa 1.jpg|Chisa 2.jpg", "renumber", "png", "", "Chisa 3.png", ""),
 ("renumber, zero padded",      C, "Chisa 05.jpg|Chisa 07.jpg", "renumber", "png", rn(("Chisa 05.jpg","Chisa 1.jpg"),("Chisa 07.jpg","Chisa 2.jpg")), "Chisa 3.png", ""),
 ("renumber, prefix case",      C, "chisa 1.jpg|Chisa 3.jpg", "renumber", "png", rn(("chisa 1.jpg","Chisa 1.jpg"),("Chisa 3.jpg","Chisa 2.jpg")), "Chisa 3.png", ""),
 ("renumber, duplicate number", C, "Chisa 1.jpg|Chisa 1.png|Chisa 3.jpg", "renumber", "png", "", "", "duplicate number 1"),
 ("design example, renumber",   C, names(C, design), "renumber", "png", rn(*shift), "Chisa 20.png", ""),
]
with open("numbering.csv", "w", newline="", encoding="utf8") as f:
    w = csv.writer(f)
    w.writerow(["case", "prefix", "existing", "mode", "ext", "renames", "new_name", "error"])
    w.writerows(ROWS)
print(len(ROWS), "rows written")
