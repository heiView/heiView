// Run after npm run build. API fixtures never touch the project database.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium, expect } = require('@playwright/test');

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
      if (['/api/admin/further-info-queue', '/api/admin/stale-overrides', '/api/admin/feedback'].includes(url.pathname)) {
        return route.fulfill({ json: [] });
      }
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

    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    const searchInput = page.getByPlaceholder('Course or instructor');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('course');
    await page.getByText('2026WS SEARCH COURSE', { exact: true }).waitFor();
    assert.ok(requests.some(url => url.includes('/api/search?') && url.includes('semester=2026WS')));
    await searchInput.press('Escape');
    await page.getByRole('button', { name: 'Open search', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    assert.equal(await searchInput.inputValue(), 'course');
    await page.locator('.hei-board-card').click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: 'Open search', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open search', exact: true }).click();
    assert.equal(await searchInput.inputValue(), 'course');
    await page.getByPlaceholder('Course or instructor').fill('');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
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

    async function checkNavbar(admin = false) {
      for (const width of [1440, 1200, 1110, 1100, 900, 760, 640, 500, 400, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(260);
        const layout = await page.locator('.hei-topbar').evaluate(header => {
          const rect = element => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width, centerY: box.top + box.height / 2 };
          };
          const controls = [...header.querySelectorAll('.hei-topbar-campus, .hei-topbar-building, .hei-topbar-date, .hei-toolbar-core > .hei-toolbar-icon-button, .hei-search-toggle, .hei-admin-tools')].map(rect);
          const logo = header.querySelector('.hei-topbar-watermark');
          const logoBox = logo.getBoundingClientRect();
          const headerBox = header.getBoundingClientRect();
          return { controls, width: document.documentElement.clientWidth,
            logoCenter: logoBox.left + logoBox.width / 2,
            headerCenter: headerBox.left + headerBox.width / 2,
            logoPointerEvents: getComputedStyle(logo).pointerEvents,
            buildingWidth: header.querySelector('.hei-topbar-building').getBoundingClientRect().width,
            dateOpacity: getComputedStyle(header.querySelector('.hei-topbar-date input')).opacity,
          };
        });
        assert.ok(Math.abs(layout.logoCenter - layout.headerCenter) < 1, `Logo center at ${width}`);
        assert.equal(layout.logoPointerEvents, 'none');
        for (const control of layout.controls) {
          assert.ok(control.left >= 0 && control.right <= layout.width + 1, `${admin ? 'Admin' : 'Public'} control fits at ${width}: ${JSON.stringify(layout)}`);
          assert.ok(Math.abs(control.centerY - layout.controls[0].centerY) < 2, `One row at ${width}`);
        }
        for (let index = 1; index < layout.controls.length; index++) {
          assert.ok(layout.controls[index - 1].right <= layout.controls[index].left + 1, `Controls do not overlap at ${width}`);
        }
        if (width === 900) assert.equal(layout.dateOpacity, '1');
        if (width === 760) {
          assert.equal(layout.dateOpacity, '0');
          assert.equal(layout.buildingWidth, 250);
        }
        if (width === 500) assert.ok(layout.buildingWidth < 250);
        if (process.env.HEIVIEW_NAV_SCREENSHOTS && [1440, 375].includes(width)) {
          await page.screenshot({ path: path.join(process.env.HEIVIEW_NAV_SCREENSHOTS, `heiview-nav-${admin ? 'admin' : 'public'}-${width}.png`) });
        }

        const toggle = page.getByRole('button', { name: 'Open search', exact: true });
        const before = await page.locator('.hei-topbar-date').boundingBox();
        await toggle.click();
        const field = page.getByPlaceholder(admin ? 'Course or lecturer' : 'Course or instructor');
        await expect(field).toBeFocused();
        await page.waitForTimeout(280);
        const after = await page.locator('.hei-topbar-date').boundingBox();
        assert.ok(after.x < before.x - 100, `Date moves left at ${width}`);
        const close = page.getByRole('button', { name: 'Close search', exact: true });
        const closeBox = await close.boundingBox();
        assert.ok(closeBox.x >= 0 && closeBox.x + closeBox.width <= layout.width + 1, `Search stays reachable at ${width}`);
        await field.fill('retained query');
        await field.press('Escape');
        await page.waitForTimeout(280);
        await toggle.click();
        assert.equal(await field.inputValue(), 'retained query');
        await field.fill('');
        await close.click();
        await page.waitForTimeout(280);
      }
      await page.locator('.hei-topbar-date').click();
      await page.locator('.ant-picker-dropdown:visible').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.hei-topbar-building').click();
      await page.locator('.hei-building-dropdown-multi:visible').waitFor();
      assert.equal(await page.locator('.hei-building-dropdown-multi .ant-select-item-option-content').first().evaluate(element => getComputedStyle(element).whiteSpace), 'normal');
      await page.keyboard.press('Escape');
      console.log(`BROWSER_OK: ${admin ? 'admin' : 'public'} navbar stays in one row from 320–1440px; watermark, compact date, search movement, focus and retained query verified.`);
    }

    await checkNavbar();
    const themeButton = page.locator('.hei-toolbar-core > button').first();
    const originalTheme = await page.locator('html').getAttribute('data-theme');
    await themeButton.click();
    assert.notEqual(await page.locator('html').getAttribute('data-theme'), originalTheme);
    if (process.env.HEIVIEW_NAV_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.HEIVIEW_NAV_SCREENSHOTS, 'heiview-nav-public-alternate-theme.png') });
    await themeButton.click();
    await page.evaluate(() => localStorage.setItem('admin-token', btoa(JSON.stringify({ user: 'test', role: 'superadmin' })) + '.test'));
    await page.goto(base + '/admin?date=2026-10-05');
    await page.getByText('2026WS COURSE 2026-10-05', { exact: true }).waitFor();
    await checkNavbar(true);
    await page.getByRole('button', { name: 'Admin actions', exact: true }).click();
    await page.getByRole('button', { name: 'Accounts', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Logout', exact: true }).waitFor();
    console.log('BROWSER_OK: compact admin navigation preserves account and logout actions.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
