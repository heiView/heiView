from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

from crawler.config import SEMESTERS
from crawler import heico_crawler as crawler
from crawler import menu
from crawler.checkpoint import can_resume, load_task, new_task, save_task

DETAIL_URL = crawler.DESKTOP_HOME_URL + '#/slc.tm.cp/student/courses/123?$ctx=lang=EN'


def entries(count: int) -> list[dict]:
    return [{'course_id': str(index)} for index in range(count)]


class OptionsTests(unittest.TestCase):
    def test_default_and_semester_url(self):
        self.assertEqual(crawler.parse_args([]).semester, '2026WS')
        for semester, term_id in SEMESTERS.items():
            url = crawler.build_page_url(200, semester)
            self.assertIn(f'objTermId={term_id}', url)
            self.assertIn('$skip=200&$top=100', url)
            self.assertIn('$ctx=lang=EN', url)

    def test_original_flags_and_explicit_semester(self):
        options = crawler.parse_args(['--semester', '2026SS', '-n', '3', '--skip', '27',
                                      '--concurrency', '2', '--reverse', '--show-browser'])
        self.assertEqual(options, crawler.CrawlOptions('2026SS', 3, 27, 2, True, (), True))

    def test_repeated_urls(self):
        options = crawler.parse_args(['-u', DETAIL_URL, '--url', DETAIL_URL + '&group=2'])
        self.assertEqual(len(options.url), 2)

    def test_title_prefixes_in_both_site_languages(self):
        for prefix in ('Courses', 'Lehrveranstaltungen', 'Veranstaltungen', 'Kurse'):
            with self.subTest(prefix=prefix):
                self.assertEqual(crawler.strip_title_breadcrumb(prefix + ' / American Slavery'), 'American Slavery')
        self.assertEqual(crawler.strip_title_breadcrumb('American Slavery'), 'American Slavery')

    def test_semester_comes_from_offered_field_in_both_languages(self):
        for text, expected in (
            ('Angeboten im Semester\nSommersemester 2026', '2026SS'),
            ('Angeboten im\nWintersemester 2026/27', '2026WS'),
            ('Offered in\nSummer semester 2026', '2026SS'),
            ('Offered in semester: Winter semester 2026/2027', '2026WS'),
            ('Wintersemester 2025 in title\nOffered in\nSummer semester 2026', '2026SS'),
            ('Offered in\nWinter semester 2027/28', '2027WS'),
        ):
            with self.subTest(text=text):
                self.assertEqual(crawler.extract_semester_from_text(text), expected)
        self.assertIsNone(crawler.extract_semester_from_text('Description\nWintersemester 2026'))

    def test_invalid_parameters_are_rejected(self):
        cases = [
            ['--semester', 'unknown'], ['-n', '0'], ['-n', '-1'], ['--skip', '-1'],
            ['--concurrency', '0'], ['--concurrency', '-1'], ['-n', 'abc'],
            ['--url', DETAIL_URL, '--reverse'], ['--url', DETAIL_URL, '--skip', '1'],
            ['--url', DETAIL_URL, '-n', '2'], ['--url', crawler.BASE_URL],
            ['--url', 'https://example.com/#/slc.tm.cp/student/courses/123'],
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as error:
                    crawler.parse_args(arguments)
                self.assertEqual(error.exception.code, 2)


class PaginationTests(unittest.IsolatedAsyncioTestCase):
    async def collect(self, count: int, **kwargs):
        courses = entries(count)
        requested = []

        async def fetch(skip):
            requested.append(skip)
            return courses[skip:skip + crawler.PAGE_SIZE]

        result = []
        async for _skip, batch in crawler.iter_course_pages(crawler.CrawlOptions(**kwargs), fetch):
            result.extend(int(course['course_id']) for course in batch)
        return result, requested

    async def test_reverse_empty_single_partial_exact_and_large_lists(self):
        for count in (0, 1, 99, 100, 200, 201, 250, 4563, 8100):
            with self.subTest(count=count):
                result, requested = await self.collect(count, reverse=True)
                self.assertEqual(result, list(reversed(range(count))))
                self.assertTrue(all(skip >= 0 and skip % 100 == 0 for skip in requested))

    async def test_reverse_offset_crosses_page_boundaries(self):
        for count in (100, 200, 250):
            for skip in (0, 1, 20, 99, 100, 101, 150, count, count + 1):
                with self.subTest(count=count, skip=skip):
                    result, _requested = await self.collect(count, reverse=True, skip=skip)
                    self.assertEqual(result, list(reversed(range(count)))[skip:])

    async def test_forward_offset_and_exact_multiple(self):
        for count, skip in ((0, 0), (200, 0), (250, 27), (250, 150), (250, 300)):
            with self.subTest(count=count, skip=skip):
                result, _requested = await self.collect(count, skip=skip)
                self.assertEqual(result, list(range(count))[skip:])

    async def test_ignored_offsets_fail_instead_of_looping(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse):
                fetch = AsyncMock(return_value=entries(100))
                with self.assertRaisesRegex(RuntimeError, 'pagination offset'):
                    async for _page in crawler.iter_course_pages(crawler.CrawlOptions(reverse=reverse), fetch):
                        pass

    async def test_probe_failure_is_not_end_of_list(self):
        fetch = AsyncMock(side_effect=[entries(100), TimeoutError('loading failed')])
        with self.assertRaises(TimeoutError):
            await crawler.find_last_page(fetch)

    async def test_empty_middle_page_fails_reverse_traversal(self):
        courses = entries(250)
        calls = {}

        async def fetch(skip):
            calls[skip] = calls.get(skip, 0) + 1
            # Page 100 exists during discovery but fails during traversal.
            if skip == 100 and calls[skip] > 1:
                return []
            return courses[skip:skip + 100]

        with self.assertRaisesRegex(RuntimeError, 'Unexpected empty page'):
            async for _page in crawler.iter_course_pages(crawler.CrawlOptions(reverse=True), fetch):
                pass


class CourseTitleTests(unittest.IsolatedAsyncioTestCase):
    warning = ('Die Seite ist nicht für diesen Browser optimiert. '
               'This site is not optimised for your browser.')
    title = 'Ü AT: Genesis 1-11: The Theological Polyphony of the Beginning (fällt aus!)'
    course_id = '0000000080'

    def course_page(self, headings, body=None):
        empty = types.SimpleNamespace(count=AsyncMock(return_value=0))

        def locator(selector):
            return types.SimpleNamespace(
                all_text_contents=AsyncMock(return_value=(
                    headings.get('h1', []) + headings.get('h2', []) if selector == 'h1, h2'
                    else headings.get(selector, []))),
                count=empty.count,
            )

        return types.SimpleNamespace(
            url=DETAIL_URL, locator=Mock(side_effect=locator), goto=AsyncMock(),
            wait_for_load_state=AsyncMock(), wait_for_timeout=AsyncMock(), close=AsyncMock(),
            wait_for_selector=AsyncMock(), content=AsyncMock(return_value=''),
            inner_text=AsyncMock(return_value=body or f'Number\n{self.course_id}'),
        )

    async def test_title_header_wins_over_longer_hidden_warning_and_navigation(self):
        page = self.course_page({'h1': ['Courses / ' + self.title],
                                 'h2': ['Detail Navigation', self.warning]})
        self.assertEqual(await crawler.extract_course_title(page), self.title)

    async def test_warning_headings_are_skipped_in_every_position(self):
        page = self.course_page({'h1': [self.warning, 'Detail Navigation'],
                                 'h2': [self.warning, 'Lehrveranstaltungen / ' + self.title]})
        self.assertEqual(await crawler.extract_course_title(page), self.title)
        self.assertIsNone(crawler.guess_title_from_text(self.warning))

    async def test_url_accepts_real_course_even_with_visible_warning(self):
        page = self.course_page({'h1': ['Courses / ' + self.title], 'h2': [self.warning]})
        browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
        with patch.object(crawler, 'open_course_page_with_warmup', AsyncMock(
                return_value=f'{self.warning}\nNumber\n{self.course_id}')) as open_page, \
                patch.object(crawler, 'extract_lecturers', AsyncMock(return_value=[])):
            entry = await crawler.build_entry_from_course_url(browser, DETAIL_URL)
        self.assertEqual(entry['title'], self.title)
        self.assertEqual(entry['course_id'], self.course_id)
        open_page.assert_awaited_once()
        page.close.assert_awaited_once()

    async def test_url_retries_warning_only_page_and_recovers(self):
        page = self.course_page({})
        browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
        with patch.object(crawler, 'open_course_page_with_warmup', AsyncMock(
                side_effect=[self.warning, f'Number\n{self.course_id}'])), \
                patch.object(crawler, 'extract_course_title', AsyncMock(side_effect=[None, self.title])), \
                patch.object(crawler, 'extract_lecturers', AsyncMock(return_value=[])):
            entry = await crawler.build_entry_from_course_url(browser, DETAIL_URL)
        self.assertEqual(entry['title'], self.title)

    async def test_persistent_warning_is_fetch_failure_instead_of_deleted_course(self):
        for body in (self.warning, 'heiCO'):
            with self.subTest(body=body):
                page = self.course_page({'h2': [self.warning]}, body)
                browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
                with patch.object(crawler, 'open_course_page_with_warmup', AsyncMock(return_value=body)) as open_page:
                    with self.assertRaisesRegex(RuntimeError, 'Browser warning'):
                        await crawler.build_entry_from_course_url(browser, DETAIL_URL)
                self.assertEqual(open_page.await_count, 2)
                page.close.assert_awaited_once()

    async def test_course_writer_repairs_long_bad_title_and_keeps_good_titles(self):
        for old_title in (self.warning, self.title):
            with self.subTest(old_title=old_title), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = root / crawler.build_course_filename(self.course_id)
                path.write_text(json.dumps({'title': old_title}))
                page = self.course_page({'h1': ['Courses / ' + self.title], 'h2': [self.warning]})
                browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
                entry = {'course_id': self.course_id, 'title': old_title, 'href': DETAIL_URL,
                         'course_type': 'UE', 'lecturers': []}
                with patch.object(crawler, 'expand_dates_and_groups_show_more', AsyncMock()), \
                        patch('crawler.scrape_course_details.extract_time_slots', return_value=[]), \
                        redirect_stdout(StringIO()):
                    await crawler.process_course_entry(browser, entry, {}, asyncio.Semaphore(1),
                                                       asyncio.Semaphore(1), root)
                self.assertEqual(json.loads(path.read_text())['title'], self.title)

    async def test_course_writer_keeps_original_json_when_warning_persists(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / crawler.build_course_filename(self.course_id)
            original = json.dumps({'title': self.title, 'weeks': [{'room': 'keep me'}]})
            path.write_text(original)
            page = self.course_page({'h2': [self.warning]}, self.warning)
            browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
            entry = {'course_id': self.course_id, 'title': self.title, 'href': DETAIL_URL,
                     'course_type': 'UE', 'lecturers': []}
            with patch.object(crawler, 'open_course_page_with_warmup', AsyncMock(return_value=self.warning)):
                with self.assertRaisesRegex(RuntimeError, 'Browser warning'):
                    await crawler.process_course_entry(browser, entry, {}, asyncio.Semaphore(1),
                                                       asyncio.Semaphore(1), root)
            self.assertEqual(path.read_text(), original)
            page.close.assert_awaited_once()

    async def test_course_writer_does_not_replace_course_title_with_login_title(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / crawler.build_course_filename(self.course_id)
            original = json.dumps({'title': self.title})
            path.write_text(original)
            page = self.course_page({'h1': ['Login']})
            browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
            entry = {'course_id': self.course_id, 'title': self.title, 'href': DETAIL_URL,
                     'course_type': 'UE', 'lecturers': []}
            with self.assertRaisesRegex(RuntimeError, 'Non-course page'):
                await crawler.process_course_entry(browser, entry, {}, asyncio.Semaphore(1),
                                                   asyncio.Semaphore(1), root)
            self.assertEqual(path.read_text(), original)


class RoomBuildingTests(unittest.IsolatedAsyncioTestCase):
    room_url = crawler.DESKTOP_HOME_URL + '#/pl/ui/$ctx/ris.einzelRaum?raumKey=22373'
    building = 'Theoretikum HS 2, Im Neuenheimer Feld 308, Erdgeschoß'
    warning = ' '.join(crawler.BROWSER_WARNING_MARKERS)

    def room_page(self, headings, fallback=()):
        preferred = types.SimpleNamespace(all_text_contents=AsyncMock(side_effect=headings))
        generic = types.SimpleNamespace(all_text_contents=AsyncMock(side_effect=fallback))
        return types.SimpleNamespace(
            goto=AsyncMock(), wait_for_load_state=AsyncMock(), wait_for_function=AsyncMock(),
            close=AsyncMock(), locator=Mock(side_effect=lambda selector:
                preferred if selector == crawler.ROOM_BUILDING_SELECTOR else generic),
        )

    async def test_room_subtitle_wins_over_warning_banner_and_is_cached(self):
        page = self.room_page([[self.building]], [[self.warning, self.building]])
        browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
        cache = {}
        for _ in range(2):
            self.assertEqual(await crawler.fetch_room_building(browser, self.room_url, cache,
                                                              asyncio.Semaphore(1)), self.building)
        browser.new_page.assert_awaited_once()
        page.close.assert_awaited_once()

    async def test_warning_only_page_is_retried_after_app_warmup(self):
        page = self.room_page([[], [self.building]], [[self.warning]])
        page.wait_for_function.side_effect = [TimeoutError(), None]
        browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
        cache = {}
        self.assertEqual(await crawler.fetch_room_building(browser, self.room_url, cache,
                                                          asyncio.Semaphore(1)), self.building)
        self.assertEqual([call.args[0] for call in page.goto.await_args_list],
                         [self.room_url, crawler.DESKTOP_HOME_URL, self.room_url])
        self.assertEqual(cache[self.room_url], self.building)
        page.close.assert_awaited_once()

    async def test_persistent_warning_is_never_saved_or_cached_and_can_recover(self):
        failed = self.room_page([[], []], [[self.warning], [self.warning]])
        failed.wait_for_function.side_effect = TimeoutError()
        recovered = self.room_page([[self.building]])
        browser = types.SimpleNamespace(new_page=AsyncMock(side_effect=[failed, recovered]))
        cache = {}
        with redirect_stdout(StringIO()):
            self.assertIsNone(await crawler.fetch_room_building(browser, self.room_url, cache,
                                                               asyncio.Semaphore(1)))
        self.assertNotIn(self.room_url, cache)
        self.assertEqual(await crawler.fetch_room_building(browser, self.room_url, cache,
                                                          asyncio.Semaphore(1)), self.building)
        failed.close.assert_awaited_once()
        recovered.close.assert_awaited_once()

    async def test_old_warning_and_failed_cache_entries_are_refetched(self):
        for value in (self.warning, None):
            with self.subTest(cached=value):
                page = self.room_page([[self.building]])
                browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
                cache = {self.room_url: value}
                self.assertEqual(await crawler.fetch_room_building(browser, self.room_url, cache,
                                                                  asyncio.Semaphore(1)), self.building)
                self.assertEqual(cache[self.room_url], self.building)

    async def test_legacy_headings_skip_warning_before_real_building(self):
        page = self.room_page([[]], [[self.warning, '  ' + self.building + '\n']])
        page.wait_for_function.side_effect = TimeoutError()
        browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
        self.assertEqual(await crawler.fetch_room_building(browser, self.room_url, {},
                                                          asyncio.Semaphore(1)), self.building)

    async def test_recrawl_discards_warning_from_saved_json_including_corrected_id(self):
        # Exercise the real course writer so a saved warning cannot bypass the
        # room fetch, including when the detail page corrects a stale list ID.
        course_id = '1300272228'
        location = 'Theoretikum HS 2 (6308.EG.002)'
        for entry_id in (course_id, 'old-list-id'):
            with self.subTest(entry_id=entry_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = root / crawler.build_course_filename(course_id)
                path.write_text(json.dumps({'weeks': [{'location': location,
                    'location_link': self.room_url, 'building': self.warning}]}))
                empty = Mock()
                empty.count = AsyncMock(return_value=0)
                empty.all_text_contents = AsyncMock(return_value=[])
                anchor = Mock()
                anchor.count = AsyncMock(return_value=1)
                anchor.first = anchor
                anchor.get_attribute = AsyncMock(return_value=self.room_url)
                appointment = Mock(locator=Mock(return_value=anchor), evaluate=AsyncMock(return_value=None))
                appointments = Mock(count=AsyncMock(return_value=1), nth=Mock(return_value=appointment))
                page = types.SimpleNamespace(
                    goto=AsyncMock(), wait_for_load_state=AsyncMock(), wait_for_timeout=AsyncMock(),
                    wait_for_selector=AsyncMock(), close=AsyncMock(), content=AsyncMock(return_value=''),
                    inner_text=AsyncMock(return_value=f'Number\n{course_id}'),
                    locator=Mock(side_effect=lambda selector:
                        appointments if selector == 'tm-course-group-list div.compact-appointment' else empty),
                )
                browser = types.SimpleNamespace(new_page=AsyncMock(return_value=page))
                entry = {'course_id': entry_id, 'title': 'Advanced General Relativity',
                         'href': DETAIL_URL, 'course_type': 'VO', 'lecturers': []}
                with patch('crawler.scrape_course_details.extract_time_slots', return_value=[{
                        'weekday_index': 3, 'location': location}]), \
                        patch.object(crawler, 'extract_lecturers', AsyncMock(return_value=[])), \
                        patch.object(crawler, 'expand_dates_and_groups_show_more', AsyncMock()), \
                        patch.object(crawler, 'fetch_room_building', AsyncMock(return_value=self.building)) as fetch, \
                        redirect_stdout(StringIO()):
                    await crawler.process_course_entry(browser, entry, {}, asyncio.Semaphore(1),
                                                       asyncio.Semaphore(1), root)
                fetch.assert_awaited_once()
                self.assertEqual(json.loads(path.read_text())['weeks'][0]['building'], self.building)


class CrawlTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old_record = {'currentSeason': '2026SS', 'courseCount': 4563, 'lastSyncTime': 'old'}
        (self.root / 'sync-meta.json').write_text(json.dumps(self.old_record))
        for semester in SEMESTERS:
            (self.root / semester).mkdir()
            (self.root / semester / 'sync-meta.json').write_text(json.dumps({'previous': semester}))
        self.browser = types.SimpleNamespace(close=AsyncMock())
        self.launcher = AsyncMock(return_value=self.browser)
        playwright = types.SimpleNamespace(chromium=types.SimpleNamespace(launch=self.launcher))
        # Async context manager special methods must be defined on the class.
        class Context:
            async def __aenter__(self):
                return playwright

            async def __aexit__(self, *args):
                return False

        module = types.ModuleType('playwright.async_api')
        module.async_playwright = Context
        parent = types.ModuleType('playwright')
        parent.__path__ = []
        details = types.ModuleType('crawler.scrape_course_details')
        details.extract_time_slots = lambda html: []
        modules = patch.dict('sys.modules', {'playwright': parent, 'playwright.async_api': module,
                                             'crawler.scrape_course_details': details})
        modules.start()
        self.addCleanup(modules.stop)
        self.courses = entries(250)

        async def read_page(browser, semester, skip):
            self.assertIn(semester, SEMESTERS)
            return self.courses[skip:skip + 100]

        async def process(browser, entry, room_cache, room_sem, detail_sem, output_dir):
            course_id = entry['course_id']
            filename = crawler.build_course_filename(course_id)
            (output_dir / filename).write_text(json.dumps({'id': course_id}))
            return course_id, filename, True

        self.reader = AsyncMock(side_effect=read_page)
        self.processor = AsyncMock(side_effect=process)
        self.archiver = AsyncMock()
        from crawler.database import sync_database
        self.real_syncer = sync_database
        sync_patch = patch('crawler.database.sync_database', AsyncMock())
        self.syncer = sync_patch.start()
        self.addCleanup(sync_patch.stop)
        for name, mock in [('read_course_page', self.reader), ('process_course_entry', self.processor),
                           ('archive_removed_courses', self.archiver)]:
            patcher = patch.object(crawler, name, mock)
            patcher.start()
            self.addCleanup(patcher.stop)
        output = redirect_stdout(StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def load(self, path):
        return json.loads((self.root / path).read_text())

    async def test_limited_ws_run_is_isolated_and_preserves_full_sync(self):
        record = await crawler.crawl_courses(crawler.CrawlOptions(number=2), data_dir=self.root)
        self.assertEqual(record['courseCount'], 2)
        self.assertFalse(record['complete'])
        self.assertEqual(len(list((self.root / '2026WS').glob('course-*.json'))), 2)
        self.assertEqual(list((self.root / '2026SS').glob('course-*.json')), [])
        self.assertEqual(self.load('sync-meta.json'), self.old_record)
        self.assertEqual(self.load('2026WS/sync-meta.json'), {'previous': '2026WS'})
        self.assertEqual(self.load('2026WS/last-run.json')['currentSeason'], '2026WS')
        self.archiver.assert_not_awaited()
        self.browser.close.assert_awaited_once()

    async def test_full_ws_run_updates_only_ws_full_metadata(self):
        record = await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertTrue(record['complete'])
        self.assertEqual(self.load('2026WS/sync-meta.json'), record)
        self.assertEqual(self.load('sync-meta.json'), self.old_record)
        self.assertEqual(self.archiver.await_args.args[1], self.root / '2026WS')

    async def test_full_ss_run_updates_legacy_metadata(self):
        record = await crawler.crawl_courses(crawler.CrawlOptions(semester='2026SS'), data_dir=self.root)
        self.assertTrue(record['complete'])
        self.assertEqual(self.load('sync-meta.json'), record)
        self.assertEqual(self.load('2026SS/sync-meta.json'), record)

    async def test_reverse_count_and_offset_select_the_last_courses(self):
        record = await crawler.crawl_courses(crawler.CrawlOptions(reverse=True, skip=60, number=3), data_dir=self.root)
        ids = [call.args[1]['course_id'] for call in self.processor.await_args_list]
        self.assertEqual(ids, ['189', '188', '187'])
        self.assertEqual(record['attemptedCount'], 3)
        self.assertFalse(record['complete'])
        self.archiver.assert_not_awaited()

    async def test_offset_run_is_partial(self):
        record = await crawler.crawl_courses(crawler.CrawlOptions(skip=150), data_dir=self.root)
        self.assertEqual(record['courseCount'], 100)
        self.assertFalse(record['complete'])
        self.archiver.assert_not_awaited()

    async def test_url_mode_uses_selected_directory_without_changing_full_sync(self):
        with patch.object(crawler, 'build_entry_from_course_url', AsyncMock(return_value={'course_id': 'url-course'})):
            record = await crawler.crawl_courses(crawler.CrawlOptions(url=(DETAIL_URL, DETAIL_URL)), data_dir=self.root)
        self.assertEqual(record['courseCount'], 1)
        self.assertEqual(record['mode'], 'urls')
        self.assertTrue((self.root / '2026WS/course-url-course.json').exists())
        self.assertFalse(record['complete'])
        self.archiver.assert_not_awaited()

    async def test_auto_url_mode_groups_semesters_and_uses_fixed_defaults(self):
        second_url = DETAIL_URL.replace('/123?', '/456?')
        course_by_url = {
            DETAIL_URL: {'course_id': 'shared', 'semester': '2026SS'},
            second_url: {'course_id': 'shared', 'semester': '2026WS'},
        }
        resolver = AsyncMock(side_effect=lambda browser, url: course_by_url[url])
        with patch.object(crawler, 'build_entry_from_course_url', resolver):
            records = await crawler.crawl_urls_by_semester((DETAIL_URL, second_url, DETAIL_URL),
                                                         data_dir=self.root)
        self.assertEqual(set(records), {'2026SS', '2026WS'})
        for semester in SEMESTERS:
            self.assertTrue((self.root / semester / 'course-shared.json').exists())
            task = load_task(semester, self.root)
            self.assertEqual(task['options']['concurrency'], 10)
            self.assertFalse(task['options']['show_browser'])
            self.assertEqual(records[semester]['courseCount'], 1)
            self.assertFalse(records[semester]['complete'])
            self.assertEqual(self.load(f'{semester}/sync-meta.json'), {'previous': semester})
        self.assertEqual([call.args[0] for call in self.syncer.await_args_list], ['2026SS', '2026WS'])
        self.reader.assert_not_awaited()
        self.archiver.assert_not_awaited()
        self.assertEqual(self.load('sync-meta.json'), self.old_record)

    async def test_auto_url_mode_never_guesses_missing_or_unconfigured_semester(self):
        for semester in (None, '2027WS'):
            with self.subTest(semester=semester), patch.object(crawler, 'build_entry_from_course_url',
                    AsyncMock(return_value={'course_id': 'shared', 'semester': semester})):
                with self.assertRaises((RuntimeError, ValueError)):
                    await crawler.crawl_urls_by_semester((DETAIL_URL,), data_dir=self.root)
        self.processor.assert_not_awaited()
        self.syncer.assert_not_awaited()

    async def test_failed_course_prevents_full_sync_and_archive(self):
        self.courses = entries(2)
        self.processor.side_effect = [('0', 'course-0.json', False), RuntimeError('detail failed')]
        record = await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertEqual(record['failedCount'], 1)
        self.assertFalse(record['complete'])
        self.assertEqual(self.load('2026WS/sync-meta.json'), {'previous': '2026WS'})
        self.archiver.assert_not_awaited()

    async def test_count_limit_caps_attempts_even_on_failures(self):
        self.processor.side_effect = RuntimeError('detail failed')
        record = await crawler.crawl_courses(crawler.CrawlOptions(number=2), data_dir=self.root)
        self.assertEqual(record['attemptedCount'], 2)
        self.assertEqual(self.processor.await_count, 2)
        self.assertEqual(self.reader.await_count, 1)

    async def test_empty_results_do_not_archive_or_report_full_sync(self):
        self.courses = []
        record = await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertFalse(record['complete'])
        self.archiver.assert_not_awaited()

    async def test_list_failure_preserves_full_sync_and_closes_browser(self):
        self.reader.side_effect = TimeoutError('list failed')
        with self.assertRaises(TimeoutError):
            await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertEqual(self.load('2026WS/last-run.json')['status'], 'failed')
        self.assertEqual(self.load('2026WS/sync-meta.json'), {'previous': '2026WS'})
        self.archiver.assert_not_awaited()
        self.browser.close.assert_awaited_once()

    async def test_cancelled_run_is_recorded_and_browser_is_closed(self):
        self.reader.side_effect = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertEqual(self.load('2026WS/last-run.json')['status'], 'interrupted')
        self.assertEqual(self.load('sync-meta.json'), self.old_record)
        self.browser.close.assert_awaited_once()

    async def test_browser_launch_failure_preserves_sync_and_records_failure(self):
        self.launcher.side_effect = RuntimeError('browser missing')
        with self.assertRaisesRegex(RuntimeError, 'browser missing'):
            await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        self.assertEqual(self.load('2026WS/last-run.json')['status'], 'failed')
        self.assertEqual(self.load('sync-meta.json'), self.old_record)

    async def test_script_reports_failed_courses_to_automation(self):
        with patch.object(crawler, 'parse_args', return_value=crawler.CrawlOptions()), \
                patch.object(crawler, 'crawl_courses', AsyncMock(return_value={'failedCount': 2})):
            with self.assertRaisesRegex(RuntimeError, '2 course'):
                await crawler.main()

    async def test_resume_full_task_starts_at_next_page_and_counts_previous_successes(self):
        self.courses = entries(150)
        original_reader = self.reader.side_effect

        async def interrupted_reader(browser, semester, skip):
            if skip == 100:
                raise TimeoutError('second page interrupted')
            return await original_reader(browser, semester, skip)

        self.reader.side_effect = interrupted_reader
        with self.assertRaises(TimeoutError):
            await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root)
        task = load_task('2026WS', self.root)
        self.assertEqual(len(task['successes']), 100)
        self.assertEqual(task['nextSkip'], 100)
        self.syncer.assert_not_awaited()
        self.reader.reset_mock()
        self.processor.reset_mock()
        self.reader.side_effect = original_reader
        record = await crawler.crawl_courses(crawler.CrawlOptions(), data_dir=self.root, resume=True)
        self.assertEqual(self.reader.await_args_list[0].args[2], 100)
        self.assertEqual(self.processor.await_count, 50)
        self.assertEqual(record['courseCount'], 150)
        self.assertTrue(record['complete'])
        self.assertEqual(len(self.archiver.await_args.args[2]), 150)
        self.syncer.assert_awaited_once()

    async def test_resume_retries_failed_items_without_new_attempts_or_list_scan(self):
        self.courses = entries(5)
        self.processor.side_effect = [('0', 'course-0.json', True), RuntimeError('detail failed')]
        options = crawler.CrawlOptions(number=2)
        failed = await crawler.crawl_courses(options, data_dir=self.root)
        self.assertEqual(failed['failedCount'], 1)
        self.syncer.assert_not_awaited()
        self.reader.reset_mock()
        self.processor.reset_mock()
        self.processor.side_effect = [('1', 'course-1.json', True)]
        result = await crawler.crawl_courses(options, data_dir=self.root, resume=True)
        self.reader.assert_not_awaited()
        self.processor.assert_awaited_once()
        self.assertEqual(self.processor.await_args.args[1]['course_id'], '1')
        self.assertEqual(result['attemptedCount'], 2)
        self.assertEqual(result['courseCount'], 2)
        self.assertFalse(result['complete'])
        self.assertFalse(can_resume(load_task('2026WS', self.root)))

    async def test_each_concurrent_success_is_saved_before_peer_cancellation(self):
        self.courses = entries(2)

        async def interrupted_process(browser, entry, *args):
            if entry['course_id'] == '0':
                return '0', 'course-0.json', True
            await asyncio.sleep(0)
            saved = load_task('2026WS', self.root)
            self.assertIn('0', saved['successes'])
            raise asyncio.CancelledError()

        self.processor.side_effect = interrupted_process
        options = crawler.CrawlOptions(number=2)
        with self.assertRaises(asyncio.CancelledError):
            await crawler.crawl_courses(options, data_dir=self.root)
        self.assertEqual(load_task('2026WS', self.root)['crawlStatus'], 'interrupted')
        self.processor.reset_mock()
        self.reader.reset_mock()
        self.processor.side_effect = [('1', 'course-1.json', True)]
        result = await crawler.crawl_courses(options, data_dir=self.root, resume=True)
        self.assertEqual(result['courseCount'], 2)
        self.reader.assert_not_awaited()
        self.processor.assert_awaited_once()

    async def test_reverse_resumption_does_not_repeat_last_page_discovery(self):
        self.courses = entries(250)
        original = self.reader.side_effect
        calls = {}

        async def reader(browser, semester, skip):
            calls[skip] = calls.get(skip, 0) + 1
            # Exponential discovery probes 100 once, then reverse traversal reaches it again.
            if skip == 100 and calls[skip] > 1:
                raise TimeoutError('reverse interrupted')
            return await original(browser, semester, skip)

        self.reader.side_effect = reader
        options = crawler.CrawlOptions(reverse=True)
        with self.assertRaises(TimeoutError):
            await crawler.crawl_courses(options, data_dir=self.root)
        self.assertEqual(len(load_task('2026WS', self.root)['successes']), 50)
        self.reader.reset_mock()
        self.processor.reset_mock()
        self.reader.side_effect = original
        result = await crawler.crawl_courses(options, data_dir=self.root, resume=True)
        self.assertEqual([call.args[2] for call in self.reader.await_args_list], [100, 0])
        self.assertEqual(self.processor.await_count, 200)
        self.assertEqual(result['courseCount'], 250)
        self.assertTrue(result['complete'])

    async def test_url_resumption_skips_completed_url(self):
        options = crawler.CrawlOptions(url=(DETAIL_URL, DETAIL_URL.replace('/123?', '/456?')))
        resolver = AsyncMock(side_effect=[{'course_id': '0'}, None])
        with patch.object(crawler, 'build_entry_from_course_url', resolver):
            result = await crawler.crawl_courses(options, data_dir=self.root)
        self.assertEqual(result['failedCount'], 1)
        self.processor.reset_mock()
        resolver = AsyncMock(return_value={'course_id': '1'})
        with patch.object(crawler, 'build_entry_from_course_url', resolver):
            result = await crawler.crawl_courses(options, data_dir=self.root, resume=True)
        resolver.assert_awaited_once()
        self.processor.assert_awaited_once()
        self.assertEqual(result['courseCount'], 2)

    async def test_sync_failure_keeps_crawl_completed_and_can_retry_sync_only(self):
        self.syncer.side_effect = self.real_syncer
        process = types.SimpleNamespace(wait=AsyncMock(return_value=1), returncode=1)
        with patch('asyncio.create_subprocess_exec', AsyncMock(return_value=process)):
            with self.assertRaises(RuntimeError):
                await crawler.crawl_courses(crawler.CrawlOptions(number=1), data_dir=self.root)
        task = load_task('2026WS', self.root)
        self.assertEqual(task['crawlStatus'], 'completed')
        self.assertEqual(task['syncStatus'], 'failed')
        self.assertFalse(can_resume(task))
        process = types.SimpleNamespace(wait=AsyncMock(return_value=0))
        self.reader.reset_mock()
        with patch('asyncio.create_subprocess_exec', AsyncMock(return_value=process)) as launch:
            await self.real_syncer('2026WS', data_dir=self.root)
        self.assertEqual(load_task('2026WS', self.root)['syncStatus'], 'completed')
        self.assertEqual(launch.await_args.kwargs['env']['HEIVIEW_SEMESTER'], '2026WS')
        self.reader.assert_not_awaited()

    async def test_resume_rejects_changed_parameters_and_stale_task(self):
        task = new_task(crawler.CrawlOptions(number=1))
        task['crawlStatus'] = 'failed'
        save_task(task, self.root)
        with self.assertRaises(ValueError):
            await crawler.crawl_courses(crawler.CrawlOptions(number=2), data_dir=self.root, resume=True)
        task['lastCrawlTime'] = '2020-01-01T00:00:00+00:00'
        save_task(task, self.root, crawl_activity=False)
        with self.assertRaises(ValueError):
            await crawler.crawl_courses(crawler.CrawlOptions(number=1), data_dir=self.root, resume=True)


class CheckpointTests(unittest.TestCase):
    def test_same_day_uses_berlin_date_including_midnight_and_dst(self):
        task = new_task(crawler.CrawlOptions())
        task['lastCrawlTime'] = '2026-10-11T22:30:00+00:00'
        self.assertTrue(can_resume(task, datetime(2026, 10, 12, 10, tzinfo=timezone.utc)))
        self.assertFalse(can_resume(task, datetime(2026, 10, 12, 22, 30, tzinfo=timezone.utc)))
        task['lastCrawlTime'] = '2026-10-25T00:30:00+00:00'
        self.assertTrue(can_resume(task, datetime(2026, 10, 25, 2, tzinfo=timezone.utc)))
        task['crawlStatus'] = 'completed'
        self.assertFalse(can_resume(task, datetime(2026, 10, 25, 2, tzinfo=timezone.utc)))

    def test_corrupted_or_mismatched_task_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            task = new_task(crawler.CrawlOptions())
            task['termId'] = 999
            save_task(task, root)
            with self.assertRaises(ValueError):
                load_task('2026WS', root)
            (root / '2026WS/checkpoint.json').write_text('{')
            with self.assertRaises(ValueError):
                load_task('2026WS', root)

    def test_atomic_save_never_leaves_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            task = new_task(crawler.CrawlOptions())
            for _ in range(3):
                save_task(task, root)
            self.assertEqual(load_task('2026WS', root)['id'], task['id'])
            self.assertEqual(list((root / '2026WS').glob('*.tmp')), [])


class ArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_verification_errors_keep_existing_course_and_other_semester(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(StringIO()):
            root = Path(directory)
            for semester in SEMESTERS:
                (root / semester).mkdir()
                (root / semester / 'course-stale.json').write_text(json.dumps({'detail_link': DETAIL_URL}))
            with patch.object(crawler, 'build_entry_from_course_url', AsyncMock(side_effect=TimeoutError())):
                await crawler.archive_removed_courses(None, root / '2026WS', set())
            self.assertTrue((root / '2026WS/course-stale.json').exists())
            self.assertTrue((root / '2026SS/course-stale.json').exists())
            self.assertFalse((root / '2026WS/deleted').exists())

    async def test_archive_is_limited_to_selected_semester(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(StringIO()):
            root = Path(directory)
            for semester in SEMESTERS:
                (root / semester).mkdir()
                (root / semester / 'course-stale.json').write_text(json.dumps({'detail_link': DETAIL_URL}))
            with patch.object(crawler, 'build_entry_from_course_url', AsyncMock(return_value=None)):
                await crawler.archive_removed_courses(None, root / '2026WS', set())
            self.assertTrue((root / '2026WS/deleted/course-stale.json').exists())
            self.assertTrue((root / '2026SS/course-stale.json').exists())


class MenuTests(unittest.TestCase):
    def configure(self, answers, saved_task=None):
        with patch.object(menu, 'load_task', return_value=saved_task), \
                patch('builtins.input', side_effect=answers), redirect_stdout(StringIO()):
            return menu.configure_crawl()

    def test_default_options(self):
        self.assertEqual(self.configure([''] * 7 + ['r']), crawler.CrawlOptions(concurrency=10))

    def test_invalid_values_are_retried(self):
        options = self.configure(['invalid', 'list', '2026WS', 'reverse', '0', '2', '-1', '150', '0', '3', 'maybe', 'n', 'r'])
        self.assertEqual(options, crawler.CrawlOptions(number=2, skip=150, concurrency=3, reverse=True))

    def test_edit_summary_preserves_settings(self):
        options = self.configure([''] * 7 + ['e', 'list', '2026SS'] + [''] * 5 + ['r'])
        self.assertEqual(options.semester, '2026SS')

    def test_back_can_switch_to_url_mode_and_edit_urls(self):
        second_url = DETAIL_URL.replace('/123?', '/456?')
        options = self.configure(['list', 'b', 'urls', DETAIL_URL, 'b', second_url, 'r'])
        self.assertIsInstance(options, menu.URLCrawlAction)
        self.assertEqual(options.url, (second_url,))

    def test_url_mode_rejects_invalid_url_and_supports_multiple_urls(self):
        options = self.configure(['urls', '', 'https://example.com',
                                  DETAIL_URL + ' ' + DETAIL_URL.replace('/123?', '/456?'), 'r'])
        self.assertEqual(len(options.url), 2)
        self.assertIsInstance(options, menu.URLCrawlAction)

    def test_url_mode_skips_semester_concurrency_and_browser_questions(self):
        with patch.object(menu, 'offer_saved_task') as saved, \
                patch.object(menu, 'integer') as integer, patch.object(menu, 'yes_no') as yes_no:
            self.assertEqual(self.configure(['2', DETAIL_URL, 'r']), menu.URLCrawlAction((DETAIL_URL,)))
        saved.assert_not_called()
        integer.assert_not_called()
        yes_no.assert_not_called()

    def test_switching_from_list_to_urls_discards_previous_list_settings(self):
        options = self.configure(['list', '2026SS', 'reverse', '2', '150', '3', 'y',
                                  'e', 'urls', DETAIL_URL, 'r'])
        self.assertEqual(options, menu.URLCrawlAction((DETAIL_URL,)))

    def test_run_url_mode_dispatches_to_automatic_semester_crawler(self):
        with patch.object(menu, 'configure_crawl', return_value=menu.URLCrawlAction((DETAIL_URL,))), \
                patch.object(menu, 'crawl_urls_by_semester', AsyncMock()) as crawl, \
                patch.object(menu, 'crawl_courses', AsyncMock()) as explicit_crawl:
            menu.run_crawl()
        crawl.assert_awaited_once_with((DETAIL_URL,))
        explicit_crawl.assert_not_awaited()

    def test_back_at_first_step_returns_to_main_menu(self):
        self.assertIsNone(self.configure(['b']))

    def test_same_day_resume_offer_preserves_original_options(self):
        options = crawler.CrawlOptions(semester='2026SS', number=10, concurrency=2)
        task = new_task(options)
        task['nextSkip'] = 100
        result = self.configure(['list', '2026SS', 'resume'], saved_task=task)
        self.assertEqual(result, menu.SavedTaskAction(options))

    def test_resume_offer_can_return_to_menu(self):
        task = new_task(crawler.CrawlOptions())
        self.assertIsNone(self.configure(['list', '2026WS', 'menu'], saved_task=task))

    def test_completed_task_with_failed_sync_offers_sync_only(self):
        options = crawler.CrawlOptions(number=2)
        task = new_task(options)
        task['crawlStatus'] = 'completed'
        task['syncStatus'] = 'failed'
        result = self.configure(['list', '2026WS', 'sync'], saved_task=task)
        self.assertEqual(result, menu.SavedTaskAction(options, sync_only=True))

    def test_manual_database_operation_uses_shared_sync_function(self):
        with patch('builtins.input', side_effect=['2', 'y']), \
                patch.object(menu, 'sync_database', AsyncMock()) as sync, redirect_stdout(StringIO()):
            menu.run_database_sync()
        sync.assert_awaited_once_with('2026SS')

    def test_manual_database_operation_can_return_without_sync(self):
        with patch('builtins.input', side_effect=['b']), \
                patch.object(menu, 'sync_database', AsyncMock()) as sync, redirect_stdout(StringIO()):
            menu.run_database_sync()
        sync.assert_not_awaited()

    def test_summary_can_return_to_main_menu_without_running(self):
        self.assertIsNone(self.configure([''] * 7 + ['m']))

    def test_invalid_main_selection_then_quit(self):
        with patch('builtins.input', side_effect=['bad', 'q']), redirect_stdout(StringIO()):
            menu.main([])

    def test_completed_failed_and_cancelled_tasks_return_to_main_menu(self):
        for failure in (None, RuntimeError('failed'), KeyboardInterrupt()):
            with self.subTest(failure=failure):
                handler = Mock(side_effect=failure)
                operation = menu.Operation('crawl', 'Crawl courses', handler)
                with patch.object(menu, 'OPERATIONS', (operation,)), patch('builtins.input', side_effect=['crawl', 'q']), redirect_stdout(StringIO()):
                    menu.main([])
                handler.assert_called_once()

    def test_eof_and_ctrl_c_at_main_menu_exit(self):
        for error in (EOFError(), KeyboardInterrupt()):
            with self.subTest(error=error), patch('builtins.input', side_effect=error), redirect_stdout(StringIO()):
                menu.main([])


if __name__ == '__main__':
    unittest.main()
