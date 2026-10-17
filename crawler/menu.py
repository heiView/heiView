"""Small standard-library CLI menu; crawler execution lives in heico_crawler."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from typing import Callable

from crawler.config import DATA_DIR, DEFAULT_SEMESTER, SEMESTERS
from crawler.heico_crawler import CrawlOptions, crawl_courses, crawl_urls_by_semester
from crawler.checkpoint import can_resume, load_task
from crawler.database import sync_database


class Back(Exception):
    pass


class ExitMenu(Exception):
    pass


@dataclass(frozen=True)
class SavedTaskAction:
    options: CrawlOptions
    sync_only: bool = False


@dataclass(frozen=True)
class URLCrawlAction:
    url: tuple[str, ...]


def offer_saved_task(semester: str) -> SavedTaskAction | None:
    try:
        task = load_task(semester)
    except ValueError as exc:
        print(exc)
        print('This checkpoint cannot be resumed; you can configure a new task.')
        return None
    if task is None:
        return None
    options = dict(task['options'])
    options['url'] = tuple(options.get('url', ()))
    saved = CrawlOptions(**options)
    if can_resume(task):
        print(f'\nFound an unfinished task for today: {semester}, '
              f'{"reverse" if saved.reverse else "forward"}, '
              f'{len(task["successes"])} courses completed, next page offset {task["nextSkip"]}, '
              f'{len(task["pagePending"]) + len(task["retries"]) + len(task["urlPending"])} pending/retry items.')
        print(f'Original options: limit {saved.number or "unlimited"}, initial skip {saved.skip}, '
              f'concurrency {saved.concurrency}, show browser {saved.show_browser}, URLs {list(saved.url)}')
        print(f'Started at {task["startedAt"]}; last crawled at {task["lastCrawlTime"]}.')
        choice = choose('Handle previous task', [('resume', 'Resume from checkpoint'),
                                                ('new', 'Configure a new task'),
                                                ('menu', 'Return to menu')], 'resume')
        if choice == 'resume':
            return SavedTaskAction(saved)
        if choice == 'menu':
            raise Back
    elif task['crawlStatus'] == 'completed' and task['syncStatus'] != 'completed':
        choice = choose('The previous crawl completed, but database sync did not succeed',
                        [('sync', 'Retry database sync only'),
                         ('new', 'Configure a new crawl task'),
                         ('menu', 'Return to menu')], 'sync')
        if choice == 'sync':
            return SavedTaskAction(saved, sync_only=True)
        if choice == 'menu':
            raise Back
    elif task['crawlStatus'] != 'completed':
        print('The previous task is not from today (Europe/Berlin); its checkpoint will not be used.')
    return None


def read_input(prompt: str) -> str:
    value = input(prompt).strip()
    print('\n----------------------------------------')
    if value.lower() in {'b', 'back'}:
        raise Back
    if value.lower() in {'q', 'quit', 'exit'}:
        raise ExitMenu
    return value


def choose(label: str, choices: list[tuple[str, str]], default: str) -> str:
    print(f'\n{label}')
    for index, (value, title) in enumerate(choices, 1):
        print(f'  {index}. {title}{" (default)" if value == default else ""}')
    while True:
        answer = read_input('\nPress Enter for the default, or enter b to go back, q to quit: ')
        if not answer:
            return default
        for index, (value, _title) in enumerate(choices, 1):
            if answer == str(index) or answer.lower() == value.lower():
                return value
        print('\nInvalid option. Please try again.')


def semester_choices() -> list[tuple[str, str]]:
    semesters = sorted(SEMESTERS, key=lambda key: (int(key[:4]), key[4:] == 'WS'), reverse=True)
    return [(key, key) for key in semesters]


def integer(label: str, default: int | None, *, minimum: int, optional: bool = False) -> int | None:
    default_text = 'unlimited' if default is None else str(default)
    while True:
        answer = read_input(f'{label} [default: {default_text}]: ')
        if not answer:
            return default
        if optional and answer.lower() in {'all', 'none', 'unlimited'}:
            return None
        try:
            value = int(answer)
            if value >= minimum:
                return value
        except ValueError:
            pass
        print(f'Enter an integer greater than or equal to {minimum}.'
              + (' Enter "all" for no limit.' if optional else ''))


def yes_no(label: str, default: bool) -> bool:
    while True:
        answer = read_input(f'{label} [y/n, default: {"y" if default else "n"}]: ').lower()
        if not answer:
            return default
        if answer in {'y', 'yes', '1'}:
            return True
        if answer in {'n', 'no', '0'}:
            return False
        print('Enter y or n.')


def course_urls(default: tuple[str, ...]) -> tuple[str, ...]:
    print('Each course is saved to the semester shown on its detail page automatically.')
    print('URL mode uses concurrency 10 with the browser hidden.')
    if default:
        print('Current URLs: ' + ' '.join(default))
    while True:
        answer = read_input('Course detail URLs (separate multiple URLs with spaces; press Enter to keep current values): ')
        urls = tuple(answer.split()) if answer else default
        if not urls:
            print('Enter at least one course detail URL.')
            continue
        try:
            CrawlOptions(url=urls).validate()
            return urls
        except ValueError as exc:
            print(f'Invalid URL: {exc}')


def configure_crawl() -> CrawlOptions | SavedTaskAction | URLCrawlAction | None:
    draft = {
        'semester': DEFAULT_SEMESTER, 'mode': 'list', 'reverse': False,
        'number': None, 'skip': 0, 'concurrency': 10,
        'show_browser': False, 'url': (),
    }
    index = 0
    while True:
        steps = ['mode']
        if draft['mode'] == 'list':
            steps += ['semester', 'reverse', 'number', 'skip', 'concurrency', 'show_browser']
        else:
            steps += ['url']
        try:
            if index < len(steps):
                step = steps[index]
                if step == 'semester':
                    draft[step] = choose('Select semester', semester_choices(), draft[step])
                    try:
                        saved_action = offer_saved_task(draft[step])
                    except Back:
                        return None
                    if saved_action is not None:
                        return saved_action
                elif step == 'mode':
                    draft[step] = choose('Crawl mode', [('list', 'Crawl all courses'),
                                                        ('urls', 'Crawl by URLs')], draft[step])
                elif step == 'reverse':
                    direction = choose('Traversal direction',
                                       [('forward', 'Forward: from the beginning of the list'),
                                        ('reverse', 'Reverse: from the end of the list')],
                                       'reverse' if draft[step] else 'forward')
                    draft[step] = direction == 'reverse'
                elif step == 'number':
                    draft[step] = integer('Maximum number of courses (enter "all" for no limit)',
                                          draft[step], minimum=1, optional=True)
                elif step == 'skip':
                    position = 'end' if draft['reverse'] else 'beginning'
                    draft[step] = integer(f'Number of courses to skip from the {position} of the list',
                                          draft[step], minimum=0)
                elif step == 'concurrency':
                    draft[step] = integer('Concurrency', draft[step], minimum=1)
                elif step == 'show_browser':
                    draft[step] = yes_no('Show browser', draft[step])
                elif step == 'url':
                    draft[step] = course_urls(draft[step])
                index += 1
                continue

            # URL tasks resolve their semester at execution time, so list-mode
            # choices cannot accidentally send them to a previous semester.
            if draft['mode'] == 'urls':
                options = URLCrawlAction(draft['url'])
            else:
                options = CrawlOptions(
                    semester=draft['semester'], concurrency=draft['concurrency'],
                    show_browser=draft['show_browser'], reverse=draft['reverse'],
                    number=draft['number'], skip=draft['skip'],
                )
                options.validate()
            print('\nTask summary')
            if isinstance(options, URLCrawlAction):
                print('  Mode: crawl by URLs')
                print('  Semester and output directory: detected from each course page')
                for url in options.url:
                    print(f'    {url}')
                print('  Concurrency: 10; show browser: no')
            else:
                print(f'  Semester: {options.semester}')
                print(f'  Output directory: {DATA_DIR / options.semester}')
                print(f'  Direction: {"reverse" if options.reverse else "forward"}')
                print(f'  Limit: {options.number if options.number is not None else "unlimited"}')
                print(f'  Courses to skip: {options.skip} (counted from the '
                      f'{"end" if options.reverse else "beginning"})')
                print(f'  Concurrency: {options.concurrency}; show browser: {"yes" if options.show_browser else "no"}')
            print('  r: run, e: edit, b: go back one step, m: return to main menu, q: quit.')
            answer = read_input('Select an action: ').lower()
            if answer in {'r', 'run'}:
                return options
            if answer in {'e', 'edit'}:
                index = 0
            elif answer in {'m', 'cancel'}:
                return None
            else:
                print('Enter r, e, b, m, or q.')
        except Back:
            if index == 0:
                return None
            index -= 1


def run_crawl() -> None:
    options = configure_crawl()
    if isinstance(options, SavedTaskAction):
        if options.sync_only:
            asyncio.run(sync_database(options.options.semester))
        else:
            asyncio.run(crawl_courses(options.options, resume=True))
    elif isinstance(options, URLCrawlAction):
        asyncio.run(crawl_urls_by_semester(options.url))
    elif options is not None:
        asyncio.run(crawl_courses(options))


def run_database_sync() -> None:
    try:
        semester = choose('Select semester to sync', semester_choices(), DEFAULT_SEMESTER)
        print(f'\nData directory: {DATA_DIR / semester}')
        print(f'\nHEIVIEW_SEMESTER={semester} npm run db:sync')
        if yes_no('\nRun database sync', False):
            asyncio.run(sync_database(semester))
    except Back:
        return


@dataclass(frozen=True)
class Operation:
    name: str
    label: str
    handler: Callable[[], None]
    aliases: tuple[str, ...] = ()


# Register future menu operations here.
OPERATIONS = (
    Operation('crawl', 'Crawl courses', run_crawl, ('c',)),
    Operation('sync', 'Build/sync database', run_database_sync, ('db',)),
)


def main(argv: list[str] | None = None) -> None:
    argparse.ArgumentParser(description='heiView interactive command menu (select an operation by number or command).').parse_args(argv)
    while True:
        print('\n  heiView Crawler Menu\n')
        for index, operation in enumerate(OPERATIONS, 1):
            print(f'  {index}. {operation.label} ({operation.name})')
        print('  0. Exit (q)')
        try:
            answer = read_input('\nSelect an operation: ').lower()
            if answer == '0':
                raise ExitMenu
        except Back:
            continue
        except (ExitMenu, EOFError, KeyboardInterrupt):
            print('\nExited heiView.')
            return

        operation = next((item for index, item in enumerate(OPERATIONS, 1)
                          if answer in (str(index), item.name, *item.aliases)), None)
        if operation is None:
            print('\nInvalid operation. Enter a menu number or command.')
            continue
        try:
            operation.handler()
        except (ExitMenu, EOFError):
            print('\nExited heiView.')
            return
        except KeyboardInterrupt:
            print('\nThe current operation was cancelled. Returning to the main menu.')
        except Exception as exc:
            print(f'Operation failed: {exc}')
            if isinstance(exc, ModuleNotFoundError):
                print('Install dependencies with: python -m pip install -r crawler/requirements.txt')
            print('Returning to the main menu.')
