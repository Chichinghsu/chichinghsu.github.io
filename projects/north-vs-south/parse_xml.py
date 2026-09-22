#!/usr/bin/env python3
"""
parse_xml.py — convert DGBAS 縣市指標 XML export into a full cache, plus
a curated counties.json / indicators.json / values.json for shipping.

Workflow:
  1) First pass — parse the XML into a full local cache, and dump a
     browsable catalog so you can pick what's worth shipping:
        python parse_xml.py input.xml --out ./data --list-indicators

  2) Open data/indicator_catalog.txt, copy the names you want to keep
     into data/indicators_allowlist.txt (one per line).

  3) Build the curated, shippable files from the cache (fast — no
     XML re-parsing needed):
        python parse_xml.py --out ./data \
            --indicators data/indicators_allowlist.txt \
            --since-year 2015

  Re-running step 1 with a new year's XML just updates the cache;
  re-run step 3 any time to regenerate the curated ship files.
"""
import argparse
import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

COUNTIES = [
    ("臺北市", "taipei", "north"),
    ("新北市", "new_taipei", "north"),
    ("桃園市", "taoyuan", "north"),
    ("基隆市", "keelung", "north"),
    ("新竹市", "hsinchu_city", "north"),
    ("新竹縣", "hsinchu_county", "north"),
    ("宜蘭縣", "yilan", "east"),
    ("臺中市", "taichung", "central"),
    ("苗栗縣", "miaoli", "central"),
    ("彰化縣", "changhua", "central"),
    ("南投縣", "nantou", "central"),
    ("雲林縣", "yunlin", "central"),
    ("臺南市", "tainan", "south"),
    ("高雄市", "kaohsiung", "south"),
    ("嘉義市", "chiayi_city", "south"),
    ("嘉義縣", "chiayi_county", "south"),
    ("屏東縣", "pingtung", "south"),
    ("花蓮縣", "hualien", "east"),
    ("臺東縣", "taitung", "east"),
    ("澎湖縣", "penghu", "islands"),
    ("金門縣", "kinmen", "islands"),
    ("連江縣", "lienchiang", "islands"),
]
NAME_TO_ID = {name: cid for name, cid, _ in COUNTIES}
SKIP_COLUMNS = {"總計", "臺灣地區"}

CACHE_VALUES = "_cache_values.json"       # full, unfiltered — not for shipping
CACHE_INDICATORS = "_cache_indicators.json"
CATALOG_FILE = "indicator_catalog.txt"     # human-browsable, for picking


def roc_to_western(roc_year_str):
    try:
        return int(roc_year_str.strip()) + 1911
    except (TypeError, ValueError):
        return None


def parse_value(raw):
    if raw is None:
        return None
    raw = raw.strip()
    if raw in ("", "-", "..", "N/A"):
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def iter_records(xml_path):
    for _event, elem in ET.iterparse(xml_path, events=("end",)):
        if elem.tag != "Data":
            continue
        name_el = elem.find("指標名稱")
        unit_el = elem.find("單位")
        def_el = elem.find("定義")
        year_el = elem.find("年別")
        if name_el is None or year_el is None:
            elem.clear()
            continue
        name = (name_el.text or "").strip()
        unit = (unit_el.text or "").strip() if unit_el is not None else ""
        definition = (def_el.text or "").strip() if def_el is not None else ""
        year = roc_to_western(year_el.text)
        if not name or year is None:
            elem.clear()
            continue
        for child in elem:
            if not child.tag.endswith("ItemValue"):
                continue
            county_name = child.tag[: -len("ItemValue")]
            if county_name in SKIP_COLUMNS:
                continue
            county_id = NAME_TO_ID.get(county_name)
            if county_id is None:
                print(f"  ! unknown county column '{county_name}', skipping")
                continue
            value = parse_value(child.text)
            if value is None:
                continue
            yield {
                "indicator": name,
                "county": county_id,
                "year": year,
                "value": value,
            }, name, unit, definition
        elem.clear()


def load_json(path, default):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data, minify=False):
    with open(path, "w", encoding="utf-8") as f:
        if minify:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
    size_kb = path.stat().st_size / 1024
    print(f"  wrote {path} ({len(data)} records, {size_kb:,.0f} KB)")


def compute_ranks(values):
    groups = defaultdict(list)
    for v in values:
        groups[(v["indicator"], v["year"])].append(v)
    for group in groups.values():
        group.sort(key=lambda v: v["value"], reverse=True)
        for i, v in enumerate(group, start=1):
            v["rank"] = i
    return values


def update_cache(xml_path, out_dir):
    """Parse XML and merge into the full, unfiltered on-disk cache."""
    cache_values_path = out_dir / CACHE_VALUES
    cache_indicators_path = out_dir / CACHE_INDICATORS

    indicators_by_id = {
        ind["id"]: ind for ind in load_json(cache_indicators_path, [])
    }
    values_by_key = {
        (v["indicator"], v["county"], v["year"]): v
        for v in load_json(cache_values_path, [])
    }

    print(f"Parsing {xml_path} ...")
    row_count = 0
    for record, name, unit, definition in iter_records(xml_path):
        key = (record["indicator"], record["county"], record["year"])
        values_by_key[key] = record
        row_count += 1
        if name not in indicators_by_id:
            indicators_by_id[name] = {
                "id": name, "name": name, "unit": unit,
                "definition": definition,
                "category": None, "higherIsInteresting": None,
            }
        else:
            indicators_by_id[name]["unit"] = unit
            indicators_by_id[name]["definition"] = definition
    print(f"  parsed {row_count} rows from this file")

    save_json(cache_indicators_path, list(indicators_by_id.values()))
    save_json(cache_values_path, list(values_by_key.values()))
    return indicators_by_id, values_by_key


def write_catalog(out_dir, values_by_key):
    """Dump a plain-text, skimmable list: indicator name, row count, year range."""
    stats = defaultdict(lambda: {"count": 0, "years": set()})
    for v in values_by_key.values():
        s = stats[v["indicator"]]
        s["count"] += 1
        s["years"].add(v["year"])

    lines = []
    for name, s in sorted(stats.items(), key=lambda kv: -kv[1]["count"]):
        yrs = sorted(s["years"])
        lines.append(f"{name}\t({s['count']} rows, {yrs[0]}-{yrs[-1]})")

    path = out_dir / CATALOG_FILE
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  wrote {path} — {len(lines)} distinct indicators. "
          f"Review it, then copy the ones you want (name only, before the "
          f"tab) into an allowlist file, one per line.")


def load_allowlist(path):
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("\t")[0].strip()  # tolerate pasting catalog lines as-is
        if line:
            names.add(line)
    return names


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("xml_path", type=Path, nargs="?",
                         help="DGBAS XML export file (omit to just rebuild "
                              "ship files from the existing cache)")
    parser.add_argument("--out", type=Path, default=Path("."))
    parser.add_argument("--list-indicators", action="store_true",
                         help="write indicator_catalog.txt and stop "
                              "(don't write ship files)")
    parser.add_argument("--indicators", type=Path, default=None,
                         help="text file, one indicator name per line, "
                              "to filter the shipped indicators/values")
    parser.add_argument("--since-year", type=int, default=None,
                         help="drop years before this (western calendar)")
    parser.add_argument("--minify", action="store_true",
                         help="write indicators.json/values.json without "
                              "indentation (cache files stay pretty-printed)")
    args = parser.parse_args()

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    counties_path = out_dir / "counties.json"

    if not counties_path.exists():
        counties = [{"id": cid, "name": name, "region": region}
                    for name, cid, region in COUNTIES]
        save_json(counties_path, counties)
    else:
        print("  counties.json already exists, leaving it untouched")

    if args.xml_path:
        indicators_by_id, values_by_key = update_cache(args.xml_path, out_dir)
    else:
        indicators_by_id = {
            ind["id"]: ind for ind in load_json(out_dir / CACHE_INDICATORS, [])
        }
        values_by_key = {
            (v["indicator"], v["county"], v["year"]): v
            for v in load_json(out_dir / CACHE_VALUES, [])
        }
        if not values_by_key:
            parser.error("no cache found and no xml_path given — run with "
                          "an XML file first")

    if args.list_indicators:
        write_catalog(out_dir, values_by_key)
        return

    # ---- build the curated, shippable files ----
    allowed_names = load_allowlist(args.indicators) if args.indicators else None

    ship_values = []
    for v in values_by_key.values():
        if allowed_names is not None and v["indicator"] not in allowed_names:
            continue
        if args.since_year is not None and v["year"] < args.since_year:
            continue
        ship_values.append(dict(v))  # copy, since compute_ranks mutates

    ship_values = compute_ranks(ship_values)
    ship_values.sort(key=lambda v: (v["indicator"], v["year"], v["county"]))

    used_names = {v["indicator"] for v in ship_values}
    ship_indicators = [ind for name, ind in indicators_by_id.items()
                        if name in used_names]

    save_json(out_dir / "indicators.json", ship_indicators, minify=args.minify)
    save_json(out_dir / "values.json", ship_values, minify=args.minify)
    print(f"Shipped {len(ship_indicators)} indicators, "
          f"{len(ship_values)} values.")


if __name__ == "__main__":
    main()