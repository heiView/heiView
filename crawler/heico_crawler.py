from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote, urljoin

from playwright.async_api import async_playwright

sys.path.append(str(Path(__file__).resolve().parent.parent))

from crawler.scrape_course_details import extract_time_slots

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
OUTPUT_DIR = PROJECT_ROOT / 'data' / '2026SS'
BASE_URL = 'https://heico.uni-heidelberg.de/heiCO/ee/ui/ca2/app/desktop/#/slc.tm.cp/student/courses'
DESKTOP_HOME_URL = 'https://heico.uni-heidelberg.de/heiCO/ee/ui/ca2/app/desktop/'
TERM_QUERY = '$ctx=&$skip={skip}&$top=100&objTermId=189&orgId=1'
PAGE_SIZE = 100


def compact_ws(value: str) -> str:
    return ' '.join(value.split())


def parse_course_id(raw_text: str, title: str) -> str:
    first_line = compact_ws(raw_text.splitlines()[0]) if raw_text.splitlines() else compact_ws(raw_text)
    prefix = first_line.split(title, 1)[0] if title in first_line else first_line
    prefix = prefix.strip()

    # Keep full course ids with unicode letters and symbols like -, _, /
    match = re.search(r'[\w/-]+', prefix)
    if not match:
        raise RuntimeError(f'Could not parse course id from prefix: {prefix!r}')
    return match.group(0)


def build_course_filename(course_id: str) -> str:
    safe_course_id = quote(course_id, safe='-_.~')
    return f'course-{safe_course_id}.json'


def normalize_hreflike(value: str) -> str:
    return urljoin('https://heico.uni-heidelberg.de/heiCO/ee/ui/ca2/', value)


def normalize_course_url(value: str) -> str:
    # Users sometimes pass URLs like ".../\#/slc..." from shell examples.
    # Convert escaped hash to a real hash so hash-routing works in heiCO.
    cleaned = value.strip().replace('\\#', '#')
    return normalize_hreflike(cleaned)


def build_page_url(skip: int) -> str:
    return f'{BASE_URL}?{TERM_QUERY.format(skip=skip)}'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Crawl heiCO courses for 2026SS.')
    parser.add_argument('--limit-courses', type=int, default=None, help='Stop after crawling this many courses.')
    parser.add_argument('--concurrency', type=int, default=5, help='Max number of course/room pages to crawl in parallel.')
    parser.add_argument('--show-browser', action='store_true', help='Launch Chromium in headed mode.')
    parser.add_argument(
        '--course-url',
        action='append',
        default=[],
        help='Recrawl a specific course detail page URL. Can be provided multiple times.',
    )
    parser.add_argument('--reverse', action='store_true', help='Enable reverse crawling logic.')
    return parser.parse_args()


def extract_week_note(slot: dict) -> str | None:
    raw_text = slot.get('raw')
    if not raw_text:
        return None

    segments = [compact_ws(part) for part in raw_text.split('|')]
    for segment in segments:
        if not segment:
            continue
        for label in ('Anmerkung:', 'Note:'):
            if segment.startswith(label):
                note = segment[len(label):].strip()
                return note or None

    for line in (compact_ws(line) for line in raw_text.splitlines()):
        if not line:
            continue
        for label in ('Anmerkung:', 'Note:'):
            if label in line:
                note = line.split(label, 1)[1].strip()
                return note or None
    return None


def extract_course_type_abbrev(raw_type: str | None) -> str | None:
    if not raw_type:
        return None

    value = compact_ws(raw_type)
    bracket_match = re.search(r'\(([A-Za-z0-9+/-]{1,12})\)', value)
    if bracket_match:
        return bracket_match.group(1)

    # Some pages already expose only the short code, such as "L" or "SE".
    if re.fullmatch(r'[A-Za-z0-9+/-]{1,12}', value):
        return value

    return None


def extract_body_field_value(raw_text: str, field_labels: set[str]) -> str | None:
    lines = [compact_ws(line) for line in raw_text.splitlines() if compact_ws(line)]
    stop_labels = {
        'Overview',
        'Title',
        'Titel',
        'Number',
        'Nummer',
        'Persons involved',
        'Beteiligte Personen',
        'Lecturer',
        'Dozent/in',
        'Type',
        'Art',
        'Semester hours',
        'Semesterwochenstunden',
        'ECTS credits',
        'ECTS-Punkte',
        'Course language/s',
        'Sprache(n)',
        'Offered in',
        'Angeboten im',
        'Organisation',
        'Tags',
    }

    for index, line in enumerate(lines):
        if line not in field_labels:
            continue

        for next_line in lines[index + 1:]:
            if next_line in stop_labels:
                break
            if not next_line:
                continue
            return next_line

    return None


def extract_ects_credits_from_body(raw_text: str) -> str | None:
    value = extract_body_field_value(raw_text, {'ECTS credits', 'ECTS-Punkte'})
    if not value or value in {'-', '—'}:
        return None
    return value


def extract_course_languages_from_body(raw_text: str) -> str | None:
    value = extract_body_field_value(raw_text, {'Course language/s', 'Sprache(n)'})
    if not value or value in {'-', '—'}:
        return None
    return value


def dedupe_weeks(weeks: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[tuple[object, object, object, object, object]] = set()
    deduped: list[dict[str, object]] = []
    for week in weeks:
        key = (
            week.get('day_of_week'),
            week.get('start_time'),
            week.get('end_time'),
            week.get('location_link'),
            week.get('room'),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(week)
    return deduped


async def safe_wait_networkidle(page) -> None:
    try:
        await page.wait_for_load_state('networkidle')
    except Exception:
        pass


async def extract_lecturers(locator) -> list[str]:
    names: list[str] = []
    links = locator.locator('a[href*="business-card"]')
    count = await links.count()
    for index in range(count):
        name = compact_ws((await links.nth(index).text_content()) or '')
        if name and name not in names:
            names.append(name)
    return names


async def fetch_room_building(
    browser,
    room_href: str,
    cache: dict[str, str | None],
    semaphore: asyncio.Semaphore,
) -> str | None:
    if room_href in cache:
        return cache[room_href]

    async with semaphore:
        page = await browser.new_page()
        try:
            await page.goto(room_href, wait_until='domcontentloaded', timeout=30000)
            await safe_wait_networkidle(page)
            await page.wait_for_timeout(1000)
            heading = page.locator('h2').first
            building = compact_ws((await heading.text_content()) or '') if await heading.count() > 0 else None
            cache[room_href] = building or None
            return cache[room_href]
        finally:
            await page.close()


async def extract_course_entries(page) -> list[dict[str, object]]:
    listitems = page.locator('[role="listitem"]')
    count = await listitems.count()
    entries: list[dict[str, object]] = []

    for item_index in range(count):
        item = listitems.nth(item_index)
        title_links = item.locator('a[href*="/slc.tm.cp/student/courses/"]')
        title_count = await title_links.count()
        title = None
        href = None

        for link_index in range(title_count):
            anchor = title_links.nth(link_index)
            text = compact_ws((await anchor.text_content()) or '')
            if text and text != '':
                title = text
                href = await anchor.get_attribute('href')
                if href:
                    href = urljoin('https://heico.uni-heidelberg.de/heiCO/ee/ui/ca2/', href)
                break

        if not title or not href:
            continue

        raw_text = await item.inner_text()
        raw_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        course_id = parse_course_id(raw_text, title)
        type_line = raw_lines[1] if len(raw_lines) > 1 else ''
        raw_course_type = type_line.split('|', 1)[0].strip() if type_line else None
        course_type = extract_course_type_abbrev(raw_course_type)

        lecturer_names = await extract_lecturers(item)

        entries.append(
            {
                'course_id': course_id,
                'title': title,
                'href': href,
                'course_type': course_type,
                'lecturers': lecturer_names,
            }
        )

    return entries


def guess_title_from_text(raw_text: str) -> str | None:
    lines = [compact_ws(line) for line in raw_text.splitlines() if compact_ws(line)]
    for line in lines:
        # Skip generic navigation-like lines.
        if line in {'heiCO', 'Termine und Gruppen', 'Dates and Groups'}:
            continue
        if len(line) < 3:
            continue
        return line
    return None


def extract_course_id_from_number_field(raw_text: str) -> str | None:
    lines = [compact_ws(line) for line in raw_text.splitlines() if compact_ws(line)]

    for index, line in enumerate(lines):
        # heiCO detail pages commonly show "Number" as a field label.
        if line not in {'Number', 'Nummer'}:
            continue

        for next_line in lines[index + 1:]:
            if next_line in {'Persons involved', 'Beteiligte Personen', 'Lecturer', 'Dozent/in'}:
                break
            if not next_line or next_line in {'-', '—'}:
                continue

            match = re.search(r'[\w/-]+', next_line)
            if match:
                return match.group(0)
            break

    return None


def extract_course_type_from_type_field(raw_text: str) -> str | None:
    lines = [compact_ws(line) for line in raw_text.splitlines() if compact_ws(line)]

    for index, line in enumerate(lines):
        # heiCO detail pages show type under a dedicated field label.
        if line not in {'Type', 'Art'}:
            continue

        for next_line in lines[index + 1:]:
            if next_line in {
                'Semester hours',
                'Semesterwochenstunden',
                'ECTS credits',
                'Course language/s',
                'Sprache(n)',
                'Offered in',
                'Angeboten im',
                'Organisation',
            }:
                break
            if not next_line or next_line in {'-', '—'}:
                continue
            return extract_course_type_abbrev(next_line)

    return None


async def open_course_page_with_warmup(page, course_url: str) -> str:

    await page.goto(DESKTOP_HOME_URL, wait_until='domcontentloaded', timeout=30000)
    await safe_wait_networkidle(page)
    await page.wait_for_timeout(1200)

    await page.goto(course_url, wait_until='domcontentloaded', timeout=30000)
    await safe_wait_networkidle(page)
    await page.wait_for_timeout(800)
    return await page.inner_text('body')


async def expand_dates_and_groups_show_more(page) -> None:
    group_list = page.locator('tm-course-group-list').first
    selectors = (
        'button:has-text("Show more")',
        'button:has-text("Mehr anzeigen")',
        'button:has-text("Weitere anzeigen")',
        'a:has-text("Show more")',
        'a:has-text("Mehr anzeigen")',
        'a:has-text("Weitere anzeigen")',
        '[role="switch"]:has-text("Show more")',
        '[role="switch"]:has-text("Mehr anzeigen")',
        '[role="switch"]:has-text("Weitere anzeigen")',
    )

    async def click_first_visible(locator) -> bool:
        count = await locator.count()
        for index in range(count):
            candidate = locator.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                await candidate.click(timeout=1500)
                return True
            except Exception:
                continue
        return False

    for _ in range(24):
        clicked = False
        for selector in selectors:
            locator = group_list.locator(selector)
            if await click_first_visible(locator):
                clicked = True
                await safe_wait_networkidle(page)
                await page.wait_for_timeout(250)
                break
        if not clicked:
            break


async def build_entry_from_course_url(browser, course_url: str) -> dict[str, object] | None:
    page = await browser.new_page()
    try:
        raw_text = await open_course_page_with_warmup(page, course_url)
        raw_text_compact = compact_ws(raw_text)

        browser_warning_markers = (
            'Die Seite ist nicht für diesen Browser optimiert.',
            'This site is not optimised for your browser.',
        )
        if any(marker in raw_text_compact for marker in browser_warning_markers):
            # Retry once after re-opening app shell in case first load got stuck on warning page.
            raw_text = await open_course_page_with_warmup(page, course_url)
            raw_text_compact = compact_ws(raw_text)

        if any(marker in raw_text_compact for marker in browser_warning_markers):
            print(
                'Detected browser warning page instead of course detail page. '
                f'Please verify URL/login: {course_url}'
            )
            return None

        title = None
        for selector in ('h1', 'h2', '.page-header h1', '.page-header h2'):
            try:
                node = page.locator(selector).first
                if await node.count() > 0:
                    candidate = compact_ws((await node.text_content()) or '')
                    if candidate:
                        title = candidate
                        break
            except Exception:
                pass

        if not title:
            title = guess_title_from_text(raw_text)
        if not title:
            print(f'Could not determine title for {course_url}; skipping')
            return None

        course_id = extract_course_id_from_number_field(raw_text)
        if not course_id:
            course_id = parse_course_id(raw_text, title)
        course_type = extract_course_type_from_type_field(raw_text)

        lecturer_names = await extract_lecturers(page)

        return {
            'course_id': course_id,
            'title': title,
            'href': course_url,
            'course_type': course_type,
            'lecturers': lecturer_names,
        }
    finally:
        await page.close()


async def process_course_entry(
    browser,
    entry: dict[str, object],
    room_cache: dict[str, str | None],
    room_semaphore: asyncio.Semaphore,
    detail_semaphore: asyncio.Semaphore,
) -> tuple[str, str, bool] | None:
    course_id = entry['course_id']  # type: ignore[index]
    title = entry['title']  # type: ignore[index]
    href = entry['href']  # type: ignore[index]
    course_type = entry['course_type']  # type: ignore[index]
    lecturer_names = entry['lecturers']  # type: ignore[index]
    filename = build_course_filename(course_id)
    target_path = OUTPUT_DIR / filename

    existing_weeks: list[dict[str, object]] = []
    if target_path.exists():
        try:
            existing_payload = json.loads(target_path.read_text(encoding='utf-8'))
            raw_weeks = existing_payload.get('weeks') if isinstance(existing_payload, dict) else None
            if isinstance(raw_weeks, list):
                existing_weeks = [item for item in raw_weeks if isinstance(item, dict)]
        except json.JSONDecodeError:
            existing_weeks = []

    existing_building_map: dict[tuple[str, str], str] = {}
    for existing_week in existing_weeks:
        existing_link = existing_week.get('location_link')
        existing_location = existing_week.get('location')
        existing_building = existing_week.get('building')
        if (
            isinstance(existing_link, str)
            and isinstance(existing_location, str)
            and isinstance(existing_building, str)
            and existing_building
        ):
            existing_building_map[(existing_link, existing_location)] = existing_building

    async with detail_semaphore:
        detail_page = await browser.new_page()
        try:
            await detail_page.goto(href, wait_until='domcontentloaded', timeout=30000)
            await safe_wait_networkidle(detail_page)
            await detail_page.wait_for_timeout(400)
            detail_raw_text = await detail_page.inner_text('body')
            ects_credits = extract_ects_credits_from_body(detail_raw_text)
            course_languages = extract_course_languages_from_body(detail_raw_text)
            for label in ('Termine und Gruppen', 'Dates and Groups'):
                try:
                    locator = detail_page.locator(f'text={label}')
                    if await locator.count() > 0:
                        await locator.first.click()
                        break
                except Exception:
                    pass
            try:
                await detail_page.wait_for_selector('tm-course-group-list', timeout=15000)
            except Exception:
                pass
            await expand_dates_and_groups_show_more(detail_page)
            await detail_page.wait_for_timeout(800)
            appointment_nodes = detail_page.locator('tm-course-group-list div.compact-appointment')
            appointment_count = await appointment_nodes.count()
            appointment_room_hrefs: list[str | None] = []
            for appointment_index in range(appointment_count):
                appointment = appointment_nodes.nth(appointment_index)
                room_link = None
                try:
                    location_anchor = appointment.locator('.appointment-location a[href*="raumKey="]')
                    if await location_anchor.count() > 0:
                        raw_href = await location_anchor.first.get_attribute('href')
                        if raw_href:
                            room_link = normalize_hreflike(raw_href)
                except Exception:
                    room_link = None
                appointment_room_hrefs.append(room_link)
            html = await detail_page.content()
        finally:
            await detail_page.close()

    slots = extract_time_slots(html)
    weeks = [
        {
            'day_of_week': (slot.get('weekday_index') + 1) if isinstance(slot.get('weekday_index'), int) else None,
            'start_time': slot.get('start_time'),
            'end_time': slot.get('end_time'),
            'location': slot.get('location'),
            'location_link': None,
            'room': slot.get('location'),
            'building': None,
            'note': extract_week_note(slot),
        }
        for slot in slots
    ]
    slot_count = min(len(slots), len(appointment_room_hrefs))
    for slot_index in range(slot_count):
        location_link = appointment_room_hrefs[slot_index]
        building = None
        if location_link:
            slot_location = slots[slot_index].get('location')

            if isinstance(slot_location, str):
                building = existing_building_map.get((location_link, slot_location))
                if building:
                    room_cache[location_link] = building

            if building is None:
                building = await fetch_room_building(browser, location_link, room_cache, room_semaphore)

        weeks[slot_index]['location_link'] = location_link
        weeks[slot_index]['building'] = building

    weeks = dedupe_weeks(weeks)

    start_dates = [slot.get('start_date') for slot in slots if slot.get('start_date')]
    end_dates = [slot.get('end_date') for slot in slots if slot.get('end_date')]
    payload = {
        'id': course_id,
        'title': title,
        'type': course_type,
        'ects_credits': ects_credits,
        'course_languages': course_languages,
        'lecturers': lecturer_names,
        'start_date': min(start_dates) if start_dates else None,
        'end_date': max(end_dates) if end_dates else None,
        'weeks': weeks,
        'detail_link': href,
        'exceptions': [],
        'notes': '',
    }

    if target_path.exists():
        try:
            existing_payload = json.loads(target_path.read_text(encoding='utf-8'))
            existing_for_cmp = {k: v for k, v in existing_payload.items() if k != 'last_updated'}
            if existing_for_cmp == payload:
                print(f'[{course_id}] unchanged {filename}, skipped write')
                return course_id, filename, False
        except json.JSONDecodeError:
            pass

    payload['last_updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    target_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[{course_id}] wrote {filename} with {len(weeks)} slot(s)')
    return course_id, filename, True


async def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=not args.show_browser)
        room_cache: dict[str, str | None] = {}
        room_semaphore = asyncio.Semaphore(max(1, args.concurrency))
        detail_semaphore = asyncio.Semaphore(max(1, args.concurrency))
        try:
            processed_count = 0
            updated_count = 0
            seen_course_ids: set[str] = set()
            if args.course_url:
                manual_entries: list[dict[str, object]] = []
                for raw_url in args.course_url:
                    course_url = normalize_course_url(raw_url)
                    entry = await build_entry_from_course_url(browser, course_url)
                    if entry is None:
                        continue
                    course_id = entry['course_id']  # type: ignore[index]
                    if course_id in seen_course_ids:
                        continue
                    seen_course_ids.add(course_id)
                    manual_entries.append(entry)

                tasks = [
                    process_course_entry(browser, entry, room_cache, room_semaphore, detail_semaphore)
                    for entry in manual_entries
                ]
                results = await asyncio.gather(*tasks)
                for result in results:
                    if result is None:
                        continue
                    _course_id, _filename, written = result
                    processed_count += 1
                    if written:
                        updated_count += 1
            elif args.reverse:
                skip = 4000
                found_less_than_page = False
                while True:
                    page = await browser.new_page()
                    try:
                        page_url = build_page_url(skip)
                        await page.goto(page_url, wait_until='domcontentloaded', timeout=30000)
                        await page.wait_for_timeout(5000)
                        await page.wait_for_selector('[role="listitem"]', timeout=30000)

                        entries = await extract_course_entries(page)
                        page_course_count = len(entries)
                        print(f'[REVERSE] Found {page_course_count} courses on page skip={skip}')
                        if page_course_count == 0:
                            break

                        page_entries: list[dict[str, object]] = []
                        for entry in entries:
                            course_id = entry['course_id']  # type: ignore[index]
                            if course_id in seen_course_ids:
                                continue
                            if args.limit_courses is not None and processed_count + len(page_entries) >= args.limit_courses:
                                break
                            seen_course_ids.add(course_id)
                            page_entries.append(entry)

                        tasks = [
                            process_course_entry(browser, entry, room_cache, room_semaphore, detail_semaphore)
                            for entry in page_entries
                        ]
                        results = await asyncio.gather(*tasks)
                        for result in results:
                            if result is None:
                                continue
                            _course_id, _filename, written = result
                            processed_count += 1
                            if written:
                                updated_count += 1

                        if args.limit_courses is not None and processed_count >= args.limit_courses:
                            break

                        if page_course_count < PAGE_SIZE:
                            found_less_than_page = True
                            break
                        skip += PAGE_SIZE
                    finally:
                        await page.close()

                if found_less_than_page:
                    skip = 3900
                    while skip >= 0:
                        page = await browser.new_page()
                        try:
                            page_url = build_page_url(skip)
                            await page.goto(page_url, wait_until='domcontentloaded', timeout=30000)
                            await page.wait_for_timeout(5000)
                            await page.wait_for_selector('[role="listitem"]', timeout=30000)

                            entries = await extract_course_entries(page)
                            page_course_count = len(entries)
                            print(f'[REVERSE] (decrement) Found {page_course_count} courses on page skip={skip}')
                            if page_course_count == 0:
                                break

                            page_entries: list[dict[str, object]] = []
                            for entry in entries:
                                course_id = entry['course_id']  # type: ignore[index]
                                if course_id in seen_course_ids:
                                    continue
                                if args.limit_courses is not None and processed_count + len(page_entries) >= args.limit_courses:
                                    break
                                seen_course_ids.add(course_id)
                                page_entries.append(entry)

                            tasks = [
                                process_course_entry(browser, entry, room_cache, room_semaphore, detail_semaphore)
                                for entry in page_entries
                            ]
                            results = await asyncio.gather(*tasks)
                            for result in results:
                                if result is None:
                                    continue
                                _course_id, _filename, written = result
                                processed_count += 1
                                if written:
                                    updated_count += 1

                            if args.limit_courses is not None and processed_count >= args.limit_courses:
                                break

                        finally:
                            await page.close()
                        skip -= PAGE_SIZE

            else:
                skip = 0

                while True:
                    page = await browser.new_page()
                    try:
                        page_url = build_page_url(skip)
                        await page.goto(page_url, wait_until='domcontentloaded', timeout=30000)
                        await page.wait_for_timeout(5000)
                        await page.wait_for_selector('[role="listitem"]', timeout=30000)

                        entries = await extract_course_entries(page)
                        page_course_count = len(entries)
                        print(f'Found {page_course_count} courses on page skip={skip}')
                        if page_course_count == 0:
                            break

                        page_entries: list[dict[str, object]] = []
                        for entry in entries:
                            course_id = entry['course_id']  # type: ignore[index]
                            if course_id in seen_course_ids:
                                continue
                            if args.limit_courses is not None and processed_count + len(page_entries) >= args.limit_courses:
                                break
                            seen_course_ids.add(course_id)
                            page_entries.append(entry)

                        tasks = [
                            process_course_entry(browser, entry, room_cache, room_semaphore, detail_semaphore)
                            for entry in page_entries
                        ]
                        results = await asyncio.gather(*tasks)
                        for result in results:
                            if result is None:
                                continue
                            _course_id, _filename, written = result
                            processed_count += 1
                            if written:
                                updated_count += 1

                        if args.limit_courses is not None and processed_count >= args.limit_courses:
                            break

                        if page_course_count < PAGE_SIZE:
                            break
                        skip += PAGE_SIZE
                    finally:
                        await page.close()

            skipped_count = processed_count - updated_count
            print(f'Processed {processed_count} course(s): wrote {updated_count}, skipped {skipped_count} unchanged.')
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())