"""Writes origins.csv. Expected values are typed by hand: this table is the spec for core/src/origin.rs."""
import csv
WH = "https://wallhaven.cc/w/"
D = "https://danbooru.donmai.us/posts?tags=md5%3A"
MD5 = "66b60ada665db2ba13e3aec46e6b756a"
# case, input, parent folder, site, id, page, artist, artist_id, url
ROWS = [
 ("wallhaven",              "wallhaven-1q2le9.jpg", "", "Wallhaven", "1q2le9", "", "", "", WH + "1q2le9"),
 ("wallhaven with prefix",  "naive-wallhaven-212pky.png", "", "Wallhaven", "212pky", "", "", "", WH + "212pky"),
 ("wallhaven short id",     "wallhaven-ex.png", "", "Unknown", "", "", "", "", ""),
 ("danbooru numeric post ID", "danbooru-123456.jpg", "", "Danbooru", "123456", "", "", "", "https://danbooru.donmai.us/posts/123456"),
 ("zerochan",               "Kuchiba.Chisa.full.4511113.png", "", "Zerochan", "4511113", "", "", "", "https://www.zerochan.net/4511113"),
 ("zerochan brackets",      "Hiyuki.(Wuthering.Waves).full.4698402.jpg", "", "Zerochan", "4698402", "", "", "", "https://www.zerochan.net/4698402"),
 ("zerochan skin name",     "Skadi.The.Corrupting.Heart.full.4621023.jpg", "", "Zerochan", "4621023", "", "", "", "https://www.zerochan.net/4621023"),
 ("zerochan upper ext",     "Aemeath.full.4686750.JPG", "", "Zerochan", "4686750", "", "", "", "https://www.zerochan.net/4686750"),
 ("zerochan no digits",     "x.full.abc.jpg", "", "Unknown", "", "", "", "", ""),
 ("konachan",               "konachan.net - 404420 bloomers bubbles denia_(wuthering_waves) doll.jpg", "", "Konachan.net", "404420", "", "", "", "https://konachan.net/post/show/404420"),
 ("konachan lower case",    "konachan.net - 12345 x.jpg", "", "Konachan.net", "12345", "", "", "", "https://konachan.net/post/show/12345"),
 ("yande.re",               "yande.re 1268369 chisa dress.jpg", "", "yande.re", "1268369", "", "", "", "https://yande.re/post/show/1268369"),
 ("danbooru",               f"__robin_honkai_and_1_more_drawn_by_ajeu914__{MD5}.png", "", "Danbooru", MD5, "", "", "", D + MD5),
 ("danbooru short hash",    "__x__abc.jpg", "", "Unknown", "", "", "", "", ""),
 ("pixiv from the extension", "151861634_p0--.png", "BLACKmeow-91709880", "Pixiv", "151861634", "0", "BLACKmeow", "91709880", "https://www.pixiv.net/artworks/151861634"),
 ("pixiv second page",      "151861634_p3--.png", "BLACKmeow-91709880", "Pixiv", "151861634", "3", "BLACKmeow", "91709880", "https://www.pixiv.net/artworks/151861634"),
 ("pixiv artist with dash", "151861634_p0.png", "Mizuki-ao-1234567", "Pixiv", "151861634", "0", "Mizuki-ao", "1234567", "https://www.pixiv.net/artworks/151861634"),
 ("pixiv bare name",        "138032536_p0.jpg", "Wallpapers", "Pixiv", "138032536", "0", "", "", "https://www.pixiv.net/artworks/138032536"),
 ("pixiv needs a page",     "138032536.jpg", "", "Unknown", "", "", "", "", ""),
 ("pixiv id too short",     "1234_p0.jpg", "", "Unknown", "", "", "", "", ""),
 ("hash name",              "1b3006020fef5585363280d7d5722beecb199e58.png", "", "Unknown", "", "", "", "", ""),
 ("x media id",             "G5uBmitWkAAyk8s.jpg", "", "Unknown", "", "", "", "", ""),
 ("wallpaper site name",    "naive-chisa-wuthering-waves-wuwa-art-4k-wallpaper-uhdpaper.com-19@3@d.jpg", "", "Unknown", "", "", "", "", ""),
 ("already renamed",        "Chisa 3.jpg", "", "Unknown", "", "", "", "", ""),
 ("number with a word",     "1004017-colorized.png", "", "Unknown", "", "", "", "", ""),
]
with open("origins.csv", "w", newline="", encoding="utf8") as f:
    w = csv.writer(f)
    w.writerow(["case", "input", "parent", "site", "id", "page", "artist", "artist_id", "url"])
    w.writerows(ROWS)
print(len(ROWS), "rows written")
