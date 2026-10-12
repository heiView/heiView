// Run after npm run build. API fixtures never touch the project database.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('@playwright/test');

async function main() {
  const dist = path.resolve(__dirname, '../dist');
  const requests = [];
  const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const requested = path.resolve(dist, '.' + urlPath);
    const file = requested.startsWith(dist + path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested : path.join(dist, 'index.html');
    const ext = path.extname(file);
    res.setHeader('Content-Type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    browser = await chromium.launch({ headless: true, executablePath: process.env.HEIVIEW_BROWSER_EXECUTABLE || undefined });
    const page = await browser.newPage();
    const fixture = (date, semester) => ({
      date, semester, buildings: [{ id: 'Test Building', street: 'Test Building', campus: 'Altstadt' }],
      rooms: { 'Test Building': [{ room: 'Room 1', floor: 'Ground floor', courses: [{
        id: 'shared', semester, name: `${semester} COURSE ${date}`, time: '10:00-11:00', prof: 'Test Lecturer',
      }] }] },
    });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname + url.search);
      if (url.pathname === '/api/schedule') {
        const date = url.searchParams.get('date');
        const month = Number(date.slice(5, 7));
        const semester = month < 4 ? `${Number(date.slice(0, 4)) - 1}WS`
          : `${date.slice(0, 4)}${month < 10 ? 'SS' : 'WS'}`;
        if (date === '2025-10-01') return route.fulfill({ status: 503, json: {
          code: 'SEMESTER_NOT_READY', semester: '2025WS', error: 'Not ready',
        } });
        if (date === '2026-10-07') return route.abort('failed');
        if (date === '2026-04-07') await new Promise(resolve => setTimeout(resolve, 500));
        const data = fixture(date, semester);
        if (date === '2026-10-06') data.rooms['Test Building'][0].courses = [];
        return route.fulfill({ json: data }).catch(() => {});
      }
      if (url.pathname === '/api/search') {
        const semester = url.searchParams.get('semester');
        return route.fulfill({ json: [{
          course: { id: 'shared', semester, name: `${semester} SEARCH COURSE`, time: '10:00-11:00' },
          room: 'Room 1', roomDisplayName: 'Room 1', buildingId: 'Test Building', buildingLabel: 'Test Building',
          startMinutes: 600, endMinutes: 660, hasValidTime: true,
        }] });
      }
      if (/\/slots$/.test(url.pathname)) return route.fulfill({ json: [] });
      if (url.pathname === '/api/feedback') return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: {} });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/?date=2026-10-05');
    await page.getByText('2026WS COURSE 2026-10-05', { exact: true }).waitFor();
    assert.ok(requests.every(url => !url.includes('2026SS') && !url.includes('/slots') && !url.includes('/search')));
    assert.deepEqual([...new Set(requests.filter(url => /^\/api\/(schedule|search|course)/.test(url)))],
      ['/api/schedule?date=2026-10-05']);
    console.log('BROWSER_OK: first load requests only the selected day; no historical courses or details.');

    async function selectDate(date) {
      const picker = page.locator('.hei-topbar-date input');
      await picker.fill(date);
      await picker.press('Enter');
      await page.locator('body').click({ position: { x: 5, y: 5 } });
    }
    await selectDate('2026-04-06');
    await page.getByText('2026SS COURSE 2026-04-06', { exact: true }).waitFor();
    console.log('BROWSER_OK: historical semester loads only after its date is selected.');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/course/shared/slots')),
      page.getByText('2026SS COURSE 2026-04-06', { exact: true }).click(),
    ]);
    assert.ok(requests.some(url => url.includes('/slots?semester=2026SS')));
    await page.keyboard.press('Escape');

    // A slower old date must not replace the last selected day.
    await selectDate('2026-04-07');
    await selectDate('2026-10-05');
    await page.getByText('2026WS COURSE 2026-10-05', { exact: true }).waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.getByText('2026SS COURSE 2026-04-07', { exact: true }).count(), 0);
    console.log('BROWSER_OK: stale date response cannot overwrite the latest selection.');

    await page.getByPlaceholder('Course or instructor').fill('course');
    await page.getByText('2026WS SEARCH COURSE', { exact: true }).waitFor();
    assert.ok(requests.some(url => url.includes('/api/search?') && url.includes('semester=2026WS')));
    await page.getByPlaceholder('Course or instructor').fill('');
    await page.getByText('2026WS COURSE 2026-10-05', { exact: true }).click();
    await page.waitForTimeout(150);
    assert.ok(requests.some(url => url.includes('/slots?semester=2026WS')));
    console.log('BROWSER_OK: search and same-ID course details switch semesters.');
    await page.keyboard.press('Escape');
    await selectDate('2025-10-01');
    await page.getByText(/Course data for 2025WS is not ready yet/).waitFor();
    assert.equal(await page.locator('.hei-board-card').getByText('2026WS COURSE 2026-10-05', { exact: true }).count(), 0);
    console.log('BROWSER_OK: missing semester data is shown distinctly and old courses are cleared.');
    await selectDate('2026-10-06');
    await page.getByText('No courses scheduled for this date', { exact: true }).waitFor();
    await selectDate('2026-10-07');
    await page.getByText('Could not load the schedule', { exact: true }).waitFor();
    console.log('BROWSER_OK: empty day and network failure have distinct states.');

    const before = requests.length;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const month = Number(today.slice(5, 7));
    const semester = month < 4 ? `${Number(today.slice(0, 4)) - 1}WS`
      : `${today.slice(0, 4)}${month < 10 ? 'SS' : 'WS'}`;
    await page.goto(base);
    await page.getByText(`${semester} COURSE ${today}`, { exact: true }).waitFor();
    assert.deepEqual([...new Set(requests.slice(before).filter(url => /^\/api\/(schedule|search|course)/.test(url)))],
      [`/api/schedule?date=${today}`]);
    console.log('BROWSER_OK: opening without a date defaults to today in Europe/Berlin.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
