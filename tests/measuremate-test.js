/* MeasureMate verification suite (headless Firefox via playwright-core).
   Serves the project over local HTTP, then runs the order's acceptance
   tests. Usage: node tests/measuremate-test.js */
const { firefox } = require('/home/hatch/workspace/goals/ship-one-project-per-day/hidden_files/test-tools/node_modules/playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT = '/home/hatch/workspace/daily-projects/2026-11-15-measuremate';
const PORT = 8138;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; failures.push(name); console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.join(PROJECT, urlPath);
      if (!file.startsWith(PROJECT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function dbCounts(page) {
  return await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('measuremate-db', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['measurements', 'locations'], 'readonly');
      const m = tx.objectStore('measurements').getAll();
      const l = tx.objectStore('locations').getAll();
      let done = 0; const out = {};
      m.onsuccess = () => { out.measurements = m.result.length; if (++done === 2) resolve(out); };
      l.onsuccess = () => { out.locations = l.result.length; if (++done === 2) resolve(out); };
      m.onerror = l.onerror = () => reject(new Error('getAll failed'));
    };
    req.onerror = () => reject(new Error('open failed'));
  }));
}

async function addLocation(page, name) {
  await page.click('[data-section="settings"]');
  await sleep(300);
  await page.click('#add-location-btn');
  await page.waitForSelector('#location-dialog[open]', { timeout: 5000 });
  await page.fill('#loc-name', name);
  await page.click('#location-save-btn');
  await sleep(400);
}

async function addMeasurement(page, f) {
  await page.click('[data-section="measurements"]');
  await sleep(300);
  await page.click('#list-add-btn');
  await page.waitForSelector('#measure-dialog[open]', { timeout: 5000 });
  await page.fill('#m-name', f.name);
  await page.selectOption('#m-type', f.type);
  await page.selectOption('#m-category', f.category);
  await page.selectOption('#m-location', { label: f.location });
  await page.selectOption('#m-unit', f.unit || 'cm');
  await page.fill('#m-width', String(f.width));
  if (f.depth !== undefined) await page.fill('#m-depth', String(f.depth));
  if (f.height !== undefined) await page.fill('#m-height', String(f.height));
  if (f.notes) await page.fill('#m-notes', f.notes);
  await page.click('#measure-save-btn');
  await sleep(400);
}

async function cardText(page) {
  return (await page.textContent('#measurements-groups')) || '';
}

async function selectSavedByName(page, selectId, namePart) {
  const value = await page.evaluate(([sel, part]) => {
    const opts = Array.from(document.querySelector(sel).options);
    const o = opts.find(x => x.textContent.indexOf(part) === 0);
    return o ? o.value : null;
  }, [selectId, namePart]);
  if (!value) throw new Error('option not found: ' + namePart + ' in ' + selectId);
  await page.selectOption(selectId, value);
}

(async () => {
  const server = await serve();
  const browser = await firefox.launch();
  const errors = [];
  const requests = [];
  let context, page;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', r => requests.push(r.url()));

    // 1. Fresh installation
    await page.goto(BASE, { waitUntil: 'load' });
    await sleep(800);
    let c = await dbCounts(page);
    check('1 fresh install: empty DB, zero stats, empty state', c.measurements === 0 && c.locations === 0 &&
      (await page.textContent('#stat-total')) === '0' &&
      (await page.textContent('#stat-spaces')) === '0' &&
      (await page.textContent('#stat-items')) === '0' &&
      await page.isVisible('#dashboard-empty'));

    // 2. Add a location
    await addLocation(page, 'Bedroom');
    c = await dbCounts(page);
    check('2 add location Bedroom', c.locations === 1 && (await page.textContent('#location-list')).includes('Bedroom'));

    // 3. Add a space in metres: 2 x 1 x 0.9 m -> stored as 200/100/90 cm
    await addMeasurement(page, { name: 'Living Room Wall', type: 'space', category: 'Room', location: 'Bedroom', unit: 'm', width: 2, depth: 1, height: 0.9 });
    c = await dbCounts(page);
    const stored = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('measuremate-db', 1);
      req.onsuccess = () => {
        const all = req.result.transaction('measurements', 'readonly').objectStore('measurements').getAll();
        all.onsuccess = () => resolve(all.result[0]);
      };
    }));
    check('3 add space 2m stored as 200cm', c.measurements === 1 && stored.widthCm === 200 && stored.depthCm === 100 && stored.heightCm === 90,
      JSON.stringify(stored));
    await page.click('[data-section="measurements"]');
    await sleep(300);
    check('3b card shows 200 x 100 x 90 cm', (await cardText(page)).includes('200 × 100 × 90 cm'));

    // 4. Persistence across reload
    await page.reload({ waitUntil: 'load' });
    await sleep(600);
    c = await dbCounts(page);
    check('4 persistence after reload', c.measurements === 1 && c.locations === 1);
    await page.click('[data-section="measurements"]');
    await sleep(300);
    check('4b card still shown after reload', (await cardText(page)).includes('Living Room Wall'));

    // 5. Display-unit conversion: switch default unit to metres
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.selectOption('#setting-unit', 'm');
    await page.click('#save-settings-btn');
    await sleep(400);
    await page.click('[data-section="measurements"]');
    await sleep(300);
    check('5 display unit m shows 2 x 1 x 0.9 m', (await cardText(page)).includes('2 × 1 × 0.9 m'));
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.selectOption('#setting-unit', 'cm');
    await page.click('#save-settings-btn');
    await sleep(400);

    // 6. Add items for the fit checker
    await addMeasurement(page, { name: 'Sofa', type: 'item', category: 'Furniture', location: 'Bedroom', width: 180, depth: 80, height: 75 });
    await addMeasurement(page, { name: 'Bookshelf', type: 'item', category: 'Furniture', location: 'Bedroom', width: 95, depth: 190, height: 80 });
    await addMeasurement(page, { name: 'Big Wardrobe', type: 'item', category: 'Furniture', location: 'Bedroom', width: 220, depth: 80, height: 75 });
    await addMeasurement(page, { name: 'Rug', type: 'item', category: 'Other', location: 'Bedroom', width: 150 });
    c = await dbCounts(page);
    check('6 four items added', c.measurements === 5, JSON.stringify(c));

    // 7. Fit: sofa fits the wall space, clearances +20/+20/+15
    await page.click('[data-section="fit"]');
    await sleep(300);
    await selectSavedByName(page, '#space-select', 'Living Room Wall');
    await selectSavedByName(page, '#item-select', 'Sofa');
    await page.fill('#fit-margin', '0');
    await page.click('#check-fit-btn');
    await sleep(400);
    let fitText = await page.textContent('#fit-result');
    check('7 fit: sofa fits, clearances +20/+20/+15 cm',
      fitText.includes('It fits') && fitText.includes('+20 cm') && fitText.includes('+15 cm') && fitText.includes('normal orientation'));

    // 8. Fit: bookshelf only fits rotated
    await selectSavedByName(page, '#item-select', 'Bookshelf');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('8 fit: bookshelf fits only rotated', fitText.includes('It fits') && fitText.includes('90°'));

    // 9. Fit: wardrobe does not fit, blocked by width, -20 cm
    await selectSavedByName(page, '#item-select', 'Big Wardrobe');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('9 fit: wardrobe fails, blocked by width, -20 cm',
      fitText.includes('does not fit') && fitText.includes('Blocked by: width') && fitText.includes('-20 cm'));

    // 10. Fit: rug has no depth/height -> incomplete, never claims a fit
    await selectSavedByName(page, '#item-select', 'Rug');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('10 fit: incomplete 3D rejected, not claimed as fit',
      fitText.includes('Incomplete') && !fitText.includes('It fits'));

    // 11. Fit: margin 7 cm still fits (height clearance +1); margin 8 cm fails on height
    await selectSavedByName(page, '#item-select', 'Sofa');
    await page.fill('#fit-margin', '7');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('11a fit: margin 7 fits, height clearance +1 cm',
      fitText.includes('It fits') && fitText.includes('+1 cm'));
    await page.fill('#fit-margin', '8');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('11b fit: margin 8 fails, blocked by height',
      fitText.includes('does not fit') && fitText.includes('Blocked by: height'));
    // 11c. Exact fit: manual 200x100x90 space vs 180x80x70 item, margin 10 -> all clearances 0
    await page.check('input[name="space-source"][value="manual"]');
    await page.check('input[name="item-source"][value="manual"]');
    await sleep(200);
    await page.fill('#space-w', '200'); await page.fill('#space-d', '100'); await page.fill('#space-h', '90');
    await page.fill('#item-w', '180'); await page.fill('#item-d', '80'); await page.fill('#item-h', '70');
    await page.fill('#fit-margin', '10');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('11c fit: exact fit at margin 10, all clearances +0 cm',
      fitText.includes('It fits') && (fitText.match(/\+0 cm/g) || []).length === 3);
    await page.check('input[name="space-source"][value="saved"]');
    await page.check('input[name="item-source"][value="saved"]');
    await sleep(200);

    // 12. Manual fit entry: 200x100x90 space vs 180x80x75 item fits
    await page.check('input[name="space-source"][value="manual"]');
    await page.check('input[name="item-source"][value="manual"]');
    await sleep(200);
    await page.fill('#space-w', '200'); await page.fill('#space-d', '100'); await page.fill('#space-h', '90');
    await page.fill('#item-w', '180'); await page.fill('#item-d', '80'); await page.fill('#item-h', '75');
    await page.fill('#fit-margin', '0');
    await page.click('#check-fit-btn');
    await sleep(400);
    fitText = await page.textContent('#fit-result');
    check('12 fit: manual entry fits', fitText.includes('It fits'));

    // 13. Search, filter, sort
    await page.click('[data-section="measurements"]');
    await sleep(300);
    await page.fill('#search-input', 'sofa');
    await sleep(300);
    check('13a search sofa shows 1 of 5', (await page.textContent('#result-count')).includes('Showing 1 of 5') &&
      (await cardText(page)).includes('Sofa') && !(await cardText(page)).includes('Bookshelf'));
    await page.fill('#search-input', 'zzz-no-match');
    await sleep(300);
    check('13b no match shows empty state', await page.isVisible('#measurements-empty'));
    await page.click('#clear-filters-btn');
    await sleep(300);
    await page.selectOption('#filter-category', 'Other');
    await sleep(300);
    check('13c category filter Other shows only Rug', (await cardText(page)).includes('Rug') && !(await cardText(page)).includes('Sofa'));
    await page.selectOption('#filter-category', 'all');
    await page.selectOption('#sort-select', 'name');
    await sleep(300);
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('.measure-name')).map(n => n.textContent));
    check('13d sort by name A-Z', JSON.stringify(order) === JSON.stringify(['Big Wardrobe', 'Bookshelf', 'Living Room Wall', 'Rug', 'Sofa']), JSON.stringify(order));
    await page.selectOption('#sort-select', 'newest');

    // 14. Edit: sofa width 180 -> 170
    const sofaCard = page.locator('.measure-card', { hasText: 'Sofa' }).first();
    await sofaCard.locator('.menu-btn').click();
    await sleep(200);
    await page.locator('.menu button', { hasText: 'Edit' }).first().click();
    await page.waitForSelector('#measure-dialog[open]', { timeout: 5000 });
    await page.fill('#m-width', '170');
    await page.click('#measure-save-btn');
    await sleep(400);
    check('14 edit persists: sofa now 170 cm wide', (await cardText(page)).includes('170 × 80 × 75 cm'));

    // 15. Duplicate sofa
    await page.locator('.measure-card', { hasText: 'Sofa' }).first().locator('.menu-btn').click();
    await sleep(200);
    await page.locator('.menu button', { hasText: 'Duplicate' }).first().click();
    await sleep(400);
    c = await dbCounts(page);
    check('15 duplicate creates copy', c.measurements === 6 && (await cardText(page)).includes('Sofa (copy)'));

    // 16. Delete the copy via menu + confirm
    await page.locator('.measure-card', { hasText: 'Sofa (copy)' }).locator('.menu-btn').click();
    await sleep(200);
    await page.locator('.menu button', { hasText: 'Delete' }).first().click();
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-ok-btn');
    await sleep(400);
    c = await dbCounts(page);
    check('16 delete copy removes only it', c.measurements === 5 && !(await cardText(page)).includes('Sofa (copy)'));

    // 17. Validation: width 0 rejected, dialog stays open, nothing saved
    await page.click('#list-add-btn');
    await page.waitForSelector('#measure-dialog[open]', { timeout: 5000 });
    await page.fill('#m-name', 'Bad Item');
    await page.selectOption('#m-location', { label: 'Bedroom' });
    await page.fill('#m-width', '0');
    await page.click('#measure-save-btn');
    await sleep(400);
    let dlgOpen = await page.evaluate(() => document.getElementById('measure-dialog').open);
    c = await dbCounts(page);
    check('17a width 0 rejected, dialog stays open', dlgOpen && c.measurements === 5 &&
      (await page.textContent('#err-dims')).includes('positive'));
    await page.fill('#m-name', '');
    await page.fill('#m-width', '10');
    await page.click('#measure-save-btn');
    await sleep(400);
    dlgOpen = await page.evaluate(() => document.getElementById('measure-dialog').open);
    check('17b empty name rejected', dlgOpen && (await page.textContent('#err-name')).includes('required'));
    await page.click('#measure-cancel-btn');
    await sleep(300);

    // 18. XSS: user string shown as text, never as HTML
    await addMeasurement(page, { name: '<img src=x onerror=alert(1)>', type: 'item', category: 'Other', location: 'Bedroom', width: 10 });
    const imgCount = await page.locator('.measure-card img').count();
    check('18 user HTML escaped, no img element created', imgCount === 0 &&
      (await cardText(page)).includes('<img src=x onerror=alert(1)>'));
    // remove the XSS probe so later counts stay clean
    await page.locator('.measure-card', { hasText: '<img src=x' }).locator('.menu-btn').click();
    await sleep(200);
    await page.locator('.menu button', { hasText: 'Delete' }).first().click();
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-ok-btn');
    await sleep(400);

    // 19. Locations: rename Bedroom -> Main Bedroom
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.locator('.location-item', { hasText: 'Bedroom' }).locator('button', { hasText: 'Rename' }).click();
    await page.waitForSelector('#location-dialog[open]', { timeout: 5000 });
    await page.fill('#loc-name', 'Main Bedroom');
    await page.click('#location-save-btn');
    await sleep(400);
    await page.click('[data-section="measurements"]');
    await sleep(300);
    check('19 rename location reflected on cards', (await cardText(page)).includes('Main Bedroom'));

    // 20. Nonempty location delete: move measurements to Garage
    await addLocation(page, 'Garage');
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.locator('.location-item', { hasText: 'Main Bedroom' }).locator('button', { hasText: 'Delete' }).click();
    await page.waitForSelector('#reassign-dialog[open]', { timeout: 5000 });
    await page.selectOption('#reassign-target', { label: 'Garage' });
    await page.click('#reassign-confirm-btn');
    await sleep(500);
    c = await dbCounts(page);
    check('20a move measurements on location delete', c.locations === 1 && c.measurements === 5);
    await page.click('[data-section="measurements"]');
    await sleep(300);
    check('20b cards now grouped under Garage', (await cardText(page)).includes('Garage') && !(await cardText(page)).includes('Main Bedroom'));

    // 21. Nonempty location delete: delete measurements with it
    await addLocation(page, 'Attic');
    await addMeasurement(page, { name: 'Old Lamp', type: 'item', category: 'Other', location: 'Attic', width: 30, depth: 30, height: 40 });
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.locator('.location-item', { hasText: 'Attic' }).locator('button', { hasText: 'Delete' }).click();
    await page.waitForSelector('#reassign-dialog[open]', { timeout: 5000 });
    await page.check('input[name="reassign-choice"][value="delete"]');
    await page.click('#reassign-confirm-btn');
    await sleep(500);
    c = await dbCounts(page);
    check('21 delete location with its measurements', c.locations === 1 && c.measurements === 5);

    // 22. Empty location deletes directly
    await addLocation(page, 'Spare Room');
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.locator('.location-item', { hasText: 'Spare Room' }).locator('button', { hasText: 'Delete' }).click();
    await page.waitForSelector('#confirm-dialog[open]', { timeout: 5000 });
    await page.click('#confirm-ok-btn');
    await sleep(400);
    c = await dbCounts(page);
    check('22 empty location deletes directly', c.locations === 1);

    // 23. Export / clear / import round trip
    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await page.click('#export-btn');
    const download = await downloadPromise;
    const backupPath = path.join(os.tmpdir(), 'measuremate-backup-test.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    check('23a export contains 5 measurements, 1 location', backup.version === 1 &&
      backup.measurements.length === 5 && backup.locations.length === 1);

    // 24. Malformed import rejected, data unchanged
    const badPath = path.join(os.tmpdir(), 'measuremate-bad.json');
    fs.writeFileSync(badPath, '{not json');
    await page.setInputFiles('#import-file', badPath);
    await sleep(500);
    c = await dbCounts(page);
    check('24a malformed JSON rejected, data unchanged', c.measurements === 5 &&
      (await page.textContent('#import-error')).includes('not valid JSON'));
    const dupPath = path.join(os.tmpdir(), 'measuremate-dup.json');
    const dup = JSON.parse(JSON.stringify(backup));
    dup.measurements.push(JSON.parse(JSON.stringify(backup.measurements[0])));
    fs.writeFileSync(dupPath, JSON.stringify(dup));
    await page.setInputFiles('#import-file', dupPath);
    await sleep(500);
    c = await dbCounts(page);
    check('24b duplicate-ID backup rejected, data unchanged', c.measurements === 5 &&
      (await page.textContent('#import-error')).includes('Duplicate'));

    // 25. Clear all (wrong DELETE first), then import restores
    await page.click('#clear-all-btn');
    await page.waitForSelector('#clearall-dialog[open]', { timeout: 5000 });
    await page.fill('#clearall-input', 'delete');
    await page.click('#clearall-confirm-btn');
    await sleep(400);
    let clearOpen = await page.evaluate(() => document.getElementById('clearall-dialog').open);
    c = await dbCounts(page);
    check('25a wrong DELETE word rejected, data kept', clearOpen && c.measurements === 5);
    await page.fill('#clearall-input', 'DELETE');
    await page.click('#clearall-confirm-btn');
    await sleep(500);
    c = await dbCounts(page);
    check('25b clear all empties both stores', c.measurements === 0 && c.locations === 0);
    await page.setInputFiles('#import-file', backupPath);
    await sleep(600);
    c = await dbCounts(page);
    check('25c import restores 5 measurements, 1 location', c.measurements === 5 && c.locations === 1 &&
      (await page.textContent('#import-success')).includes('5 measurements'));

    // 26. Theme persists across reload
    await page.selectOption('#setting-theme', 'dark');
    await page.click('#save-settings-btn');
    await sleep(400);
    await page.reload({ waitUntil: 'load' });
    await sleep(600);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('26 dark theme persists after reload', theme === 'dark');
    await page.click('[data-section="settings"]');
    await sleep(300);
    await page.selectOption('#setting-theme', 'light');
    await page.click('#save-settings-btn');
    await sleep(300);

    // 27. Layout: no horizontal overflow at several widths; bottom nav at 375
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 800 });
      await sleep(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('27 overflow at ' + w + 'px', overflow <= 0, 'overflow ' + overflow + 'px');
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(300);
    check('27b bottom nav visible at 375px', await page.isVisible('.bottomnav'));
    await page.setViewportSize({ width: 1280, height: 900 });

    // 28. Offline reload loads from service worker
    await page.goto(BASE, { waitUntil: 'load' });
    await sleep(1000);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await sleep(800);
    const offlineTitle = await page.title();
    c = await dbCounts(page);
    check('28 offline reload works, data intact', offlineTitle.includes('MeasureMate') && c.measurements === 5);
    await context.setOffline(false);

    // 29. No external requests; no page/console errors
    const external = requests.filter(u => !u.startsWith('http://127.0.0.1:' + PORT));
    check('29a zero external requests', external.length === 0, external.slice(0, 3).join(', '));
    check('29b zero page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    console.log('\nTOTAL: ' + pass + ' passed, ' + fail + ' failed');
    if (failures.length) console.log('FAILURES: ' + failures.join(' | '));
  } catch (e) {
    console.log('HARNESS ERROR: ' + (e && e.stack ? e.stack : e));
    fail++;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
    process.exit(fail ? 1 : 0);
  }
})();
