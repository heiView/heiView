from __future__ import annotations

import re
from datetime import datetime
from typing import Iterator, List, Optional

from bs4 import BeautifulSoup, NavigableString, Tag

DATE_RANGE_RE = re.compile(r"von\s+(\d{2}\.\d{2}\.\d{4})\s+bis\s+(\d{2}\.\d{2}\.\d{4})", re.IGNORECASE)
DATE_ANY_RE = re.compile(r"(\d{2}\.\d{2}\.\d{4})")
TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})")

WEEKDAY_LOOKUP = {
    "montag": 0,
    "mo": 0,
    "monday": 0,
    "dienstag": 1,
    "di": 1,
    "tuesday": 1,
    "mittwoch": 2,
    "mi": 2,
    "wednesday": 2,
    "donnerstag": 3,
    "do": 3,
    "thursday": 3,
    "freitag": 4,
    "fr": 4,
    "friday": 4,
    "samstag": 5,
    "sa": 5,
    "saturday": 5,
    "sonntag": 6,
    "so": 6,
    "sunday": 6,
}

WEEKDAY_NAMES = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
]


def clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def parse_weekday(raw: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    if not raw:
        return None, None
    value = clean_text(raw)
    lowered = value.lower().replace(".", "").strip()
    for key, idx in WEEKDAY_LOOKUP.items():
        if lowered.startswith(key):
            return WEEKDAY_NAMES[idx], idx
    return value, None


def parse_time_range(raw: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not raw:
        return None, None
    normalized = raw.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    normalized = normalized.replace(",", " ")
    match = TIME_RANGE_RE.search(normalized)
    if match:
        start, end = match.groups()
        return start, end
    return None, None


def parse_date_range(raw: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not raw:
        return None, None
    text = clean_text(raw)
    match = DATE_RANGE_RE.search(text)
    if match:
        start_raw, end_raw = match.groups()
        return _to_iso_date(start_raw), _to_iso_date(end_raw)
    fallback = DATE_ANY_RE.findall(text)
    if len(fallback) == 1:
        iso = _to_iso_date(fallback[0])
        return iso, iso
    if len(fallback) >= 2:
        return _to_iso_date(fallback[0]), _to_iso_date(fallback[1])
    return None, None


def _to_iso_date(raw: str) -> Optional[str]:
    try:
        return datetime.strptime(raw, "%d.%m.%Y").date().isoformat()
    except ValueError:
        return None


def iter_compact_appointments(group: Tag) -> Iterator[Tag]:
    for appointment in group.select("div.compact-appointment"):
        yield appointment


def parse_slot(group: Tag, appointment: Tag) -> dict:
    summary_node = group.select_one(".summary")
    group_name = clean_text(summary_node.get_text()) if summary_node else None

    icon_span = appointment.select_one(".compact-appointment-icon span")
    category = clean_text(icon_span.get_text()) if icon_span else None

    title_block = appointment.select_one(".appointment-title")
    weekday_label = None
    weekday_index = None
    if title_block:
        strong = title_block.select_one(".strong")
        title_text = strong.get_text() if strong else title_block.get_text()
        weekday_label, weekday_index = parse_weekday(title_text)

    time_span = appointment.select_one(".appointment-time")
    start_time, end_time = parse_time_range(time_span.get_text() if time_span else None)

    date_span = appointment.select_one(".appointment-date")
    start_date, end_date = parse_date_range(date_span.get_text() if date_span else None)

    location_block = appointment.select_one(".appointment-location")
    location_text = location_block.get_text(" ", strip=True) if location_block else None
    location = clean_text(location_text)

    raw_parts: List[str] = []
    for part in appointment.stripped_strings:
        text = clean_text(part)
        if text:
            raw_parts.append(text)
    raw_text = " | ".join(raw_parts)

    # Extract note from ca-more-less component (handles expanded/split text)
    note = None
    more_less = appointment.select_one("ca-more-less")
    if more_less:
        note_parts: List[str] = []
        for child in more_less.descendants:
            if not isinstance(child, NavigableString):
                continue
            parent = child.parent
            # Skip text inside control links (Show less / Mehr anzeigen etc.)
            if parent and parent.name == 'a':
                continue
            text = str(child).strip()
            if text:
                note_parts.append(text)
        full_note = ' '.join(note_parts)
        full_note = clean_text(full_note)
        if full_note:
            for prefix in ('Note:', 'Anmerkung:'):
                if full_note.startswith(prefix):
                    full_note = full_note[len(prefix):].strip()
                    break
            note = full_note or None

    return {
        "start_date": start_date,
        "end_date": end_date,
        "start_time": start_time,
        "end_time": end_time,
        "weekday_label": weekday_label,
        "weekday_index": weekday_index,
        "location": location or None,
        "group": group_name or None,
        "category": category or None,
        "raw": raw_text,
        "note": note,
    }


def extract_time_slots(html: str) -> List[dict]:
    soup = BeautifulSoup(html, "html.parser")
    slots: List[dict] = []
    group_nodes = soup.select("tm-course-group-list ca-collapsible-container.coursegroup")
    for group in group_nodes:
        for appointment in iter_compact_appointments(group):
            slot = parse_slot(group, appointment)
            slots.append(slot)
    return slots