/* MeasureMate — app.js
   UI wiring: navigation, dashboard, measurement CRUD, locations,
   fit checker, settings, backup import/export. All user-entered
   strings are inserted with textContent, never as HTML. */
(function () {
  'use strict';

  var D = window.MeasureMateDomain;
  var DB = window.MeasureMateDB;
  var Fit = window.MeasureMateFit;

  var SETTINGS_KEY = 'measuremate-settings-v1';
  var DEFAULT_SETTINGS = { defaultUnit: 'cm', theme: 'system', defaultMarginCm: 0 };

  /* ---------- tiny DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function show(node, on) { node.hidden = !on; }

  /* ---------- settings ---------- */
  function loadSettings() {
    try {
      var raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      var s = {
        defaultUnit: D.UNIT_IDS.indexOf(raw.defaultUnit) !== -1 ? raw.defaultUnit : DEFAULT_SETTINGS.defaultUnit,
        theme: ['system', 'light', 'dark'].indexOf(raw.theme) !== -1 ? raw.theme : DEFAULT_SETTINGS.theme,
        defaultMarginCm: (typeof raw.defaultMarginCm === 'number' && Number.isFinite(raw.defaultMarginCm) && raw.defaultMarginCm >= 0)
          ? raw.defaultMarginCm : DEFAULT_SETTINGS.defaultMarginCm
      };
      return s;
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
  function applyTheme(theme) {
    var dark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  var settings = loadSettings();

  /* ---------- state ---------- */
  var state = {
    measurements: [],
    locations: [],
    section: 'dashboard',
    search: '',
    typeFilter: 'all',
    categoryFilter: 'all',
    locationFilter: 'all',
    sort: 'newest',
    editingId: null,
    locationEditingId: null,
    locationDeleteId: null,
    dbFailed: false
  };

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function showFieldError(id, msg) {
    var n = $(id);
    if (!n) return;
    if (msg) { n.textContent = msg; n.hidden = false; }
    else { n.textContent = ''; n.hidden = true; }
  }

  /* ---------- data loading ---------- */
  async function reloadData() {
    state.measurements = await DB.getAllMeasurements();
    state.locations = await DB.getAllLocations();
  }

  function locationById(id) {
    for (var i = 0; i < state.locations.length; i++) {
      if (state.locations[i].id === id) return state.locations[i];
    }
    return null;
  }
  function locationName(id) {
    var loc = locationById(id);
    return loc ? loc.name : 'Unknown location';
  }
  function countInLocation(id) {
    return state.measurements.filter(function (m) { return m.locationId === id; }).length;
  }

  /* ---------- navigation ---------- */
  function showSection(name) {
    state.section = name;
    ['dashboard', 'measurements', 'fit', 'settings'].forEach(function (s) {
      show($('section-' + s), s === name);
    });
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-section') === name;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (name === 'fit') refreshFitOptions();
    if (name === 'settings') renderSettings();
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    var total = state.measurements.length;
    var spaces = state.measurements.filter(function (m) { return m.type === 'space'; }).length;
    var items = total - spaces;
    $('stat-total').textContent = String(total);
    $('stat-spaces').textContent = String(spaces);
    $('stat-items').textContent = String(items);

    show($('dashboard-empty'), total === 0);
    show($('dashboard-content'), total !== 0);
    if (total === 0) return;

    var recent = state.measurements.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 5);
    var list = $('recent-list');
    list.innerHTML = '';
    recent.forEach(function (m) {
      var li = el('li', 'recent-item');
      var main = el('div', 'recent-main');
      main.appendChild(el('div', 'recent-name', m.name));
      main.appendChild(el('div', 'recent-meta', D.formatDims(m, settings.defaultUnit) + ' · ' + locationName(m.locationId) + ' · Updated ' + D.formatUpdated(m.updatedAt)));
      var edit = el('button', 'link-btn', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () { openMeasureDialog(m.id); });
      li.appendChild(main);
      li.appendChild(edit);
      list.appendChild(li);
    });
    show($('recent-empty'), recent.length === 0);
  }

  /* ---------- measurements list ---------- */
  function filteredMeasurements() {
    var q = state.search.trim().toLowerCase();
    var list = state.measurements.filter(function (m) {
      if (state.typeFilter !== 'all' && m.type !== state.typeFilter) return false;
      if (state.categoryFilter !== 'all' && m.category !== state.categoryFilter) return false;
      if (state.locationFilter !== 'all' && m.locationId !== state.locationFilter) return false;
      if (q) {
        var hay = (m.name + ' ' + (m.notes || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (state.sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (state.sort === 'oldest') list.sort(function (a, b) { return a.updatedAt - b.updatedAt; });
    else list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return list;
  }

  function closeAllMenus() {
    document.querySelectorAll('.menu').forEach(function (menu) { menu.remove(); });
  }

  function renderMeasurements() {
    var list = filteredMeasurements();
    $('result-count').textContent = 'Showing ' + list.length + ' of ' + state.measurements.length + ' measurements';
    var groups = $('measurements-groups');
    groups.innerHTML = '';
    closeAllMenus();

    var noResults = state.measurements.length === 0 || list.length === 0;
    show($('measurements-empty'), noResults && state.measurements.length > 0);
    if (state.measurements.length === 0) {
      var empty = el('div', 'empty-state');
      empty.appendChild(el('h2', null, 'No measurements yet'));
      empty.appendChild(el('p', null, 'Add your first measurement to start building your record.'));
      var btn = el('button', 'btn btn-primary', 'Add measurement');
      btn.type = 'button';
      btn.addEventListener('click', function () { openMeasureDialog(null); });
      empty.appendChild(btn);
      groups.appendChild(empty);
      return;
    }
    if (list.length === 0) return;

    /* Group by location, locations in name order. */
    var byLoc = {};
    list.forEach(function (m) {
      (byLoc[m.locationId] = byLoc[m.locationId] || []).push(m);
    });
    var locIds = Object.keys(byLoc).sort(function (a, b) {
      return locationName(a).localeCompare(locationName(b));
    });
    locIds.forEach(function (locId) {
      groups.appendChild(el('h2', 'group-title', locationName(locId)));
      var grid = el('div', 'measure-grid');
      byLoc[locId].forEach(function (m) { grid.appendChild(measureCard(m)); });
      groups.appendChild(grid);
    });
  }

  function measureCard(m) {
    var card = el('article', 'card measure-card');
    var top = el('div', 'measure-top');
    var nameWrap = el('div');
    nameWrap.appendChild(el('div', 'measure-name', m.name));
    var badge = el('span', 'badge' + (m.type === 'item' ? ' badge-item' : ''), D.TYPES[m.type]);
    nameWrap.appendChild(badge);
    top.appendChild(nameWrap);

    var menuWrap = el('div', 'menu-wrap');
    var menuBtn = el('button', 'menu-btn', '⋯');
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Options for ' + m.name);
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var wasOpen = !!menuWrap.querySelector('.menu');
      closeAllMenus();
      if (wasOpen) return;
      var menu = el('div', 'menu');
      menu.setAttribute('role', 'menu');
      var editBtn = el('button', null, 'Edit');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { closeAllMenus(); openMeasureDialog(m.id); });
      var dupBtn = el('button', null, 'Duplicate');
      dupBtn.type = 'button';
      dupBtn.addEventListener('click', function () { closeAllMenus(); duplicateMeasurement(m.id); });
      var delBtn = el('button', 'menu-danger', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () { closeAllMenus(); deleteMeasurement(m.id); });
      menu.appendChild(editBtn);
      menu.appendChild(dupBtn);
      menu.appendChild(delBtn);
      menuWrap.appendChild(menu);
    });
    menuWrap.appendChild(menuBtn);
    top.appendChild(menuWrap);
    card.appendChild(top);

    card.appendChild(el('div', 'measure-dims', D.formatDims(m, settings.defaultUnit)));
    card.appendChild(el('div', 'measure-meta', m.category + ' · ' + locationName(m.locationId) + ' · Updated ' + D.formatUpdated(m.updatedAt)));
    if (m.notes) card.appendChild(el('div', 'measure-notes', m.notes));
    return card;
  }

  /* ---------- measurement form ---------- */
  function fillSelect(select, options, placeholder) {
    select.innerHTML = '';
    if (placeholder) {
      var ph = el('option', null, placeholder);
      ph.value = '';
      select.appendChild(ph);
    }
    options.forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = o.value;
      select.appendChild(opt);
    });
  }

  function refreshLocationSelects() {
    var opts = state.locations.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (l) { return { value: l.id, label: l.name }; });
    fillSelect($('m-location'), opts, state.locations.length ? 'Choose a location' : 'No locations yet — add one');
    fillSelect($('filter-location'),
      [{ value: 'all', label: 'All locations' }].concat(opts));
  }

  function openMeasureDialog(id) {
    state.editingId = id;
    var m = id ? state.measurements.find(function (x) { return x.id === id; }) : null;
    $('measure-dialog-title').textContent = m ? 'Edit measurement' : 'Add measurement';
    $('measure-save-btn').textContent = m ? 'Save changes' : 'Save measurement';
    fillSelect($('m-category'), D.CATEGORIES.map(function (c) { return { value: c, label: c }; }));
    refreshLocationSelects();
    $('m-name').value = m ? m.name : '';
    $('m-type').value = m ? m.type : 'space';
    $('m-category').value = m ? m.category : 'Room';
    $('m-location').value = m ? m.locationId : '';
    $('m-unit').value = settings.defaultUnit;
    $('m-width').value = m ? D.formatValue(m.widthCm, settings.defaultUnit) : '';
    $('m-depth').value = (m && m.depthCm !== null && m.depthCm !== undefined) ? D.formatValue(m.depthCm, settings.defaultUnit) : '';
    $('m-height').value = (m && m.heightCm !== null && m.heightCm !== undefined) ? D.formatValue(m.heightCm, settings.defaultUnit) : '';
    $('m-notes').value = m ? (m.notes || '') : '';
    ['err-name', 'err-location', 'err-dims', 'err-notes'].forEach(function (e) { showFieldError(e, null); });
    var dlg = $('measure-dialog');
    if (!dlg.open) dlg.showModal();
    $('m-name').focus();
  }

  function parseDimInput(inputEl, unit, required) {
    var raw = inputEl.value.trim();
    if (raw === '') return required ? { error: 'required' } : { value: null };
    var n = Number(raw);
    if (!Number.isFinite(n)) return { error: 'not a number' };
    var cm = D.toCm(n, unit);
    if (!Number.isFinite(cm) || cm <= 0) return { error: 'must be positive' };
    if (cm > 100000) return { error: 'too large' };
    return { value: cm };
  }

  async function saveMeasurementForm(ev) {
    ev.preventDefault();
    ['err-name', 'err-location', 'err-dims', 'err-notes'].forEach(function (e) { showFieldError(e, null); });
    var name = $('m-name').value.trim();
    var unit = $('m-unit').value;
    var problems = false;

    if (!name) { showFieldError('err-name', 'Name is required.'); problems = true; }
    else if (name.length > D.MAX_NAME) { showFieldError('err-name', 'Name must be ' + D.MAX_NAME + ' characters or fewer.'); problems = true; }

    var locationId = $('m-location').value;
    if (!locationId) { showFieldError('err-location', 'Choose a location, or add a new one first.'); problems = true; }

    var w = parseDimInput($('m-width'), unit, true);
    var d = parseDimInput($('m-depth'), unit, false);
    var h = parseDimInput($('m-height'), unit, false);
    if (w.error || d.error || h.error) {
      var msg = 'Width is required and must be a positive number. Depth and height are optional but must be positive when given.';
      if (w.error === 'too large' || d.error === 'too large' || h.error === 'too large') msg = 'Dimensions must be 100,000 cm or less.';
      showFieldError('err-dims', msg);
      problems = true;
    }

    var notes = $('m-notes').value;
    if (notes.length > D.MAX_NOTES) { showFieldError('err-notes', 'Notes must be ' + D.MAX_NOTES + ' characters or fewer.'); problems = true; }

    if (problems) return;

    var record = {
      id: state.editingId || D.newId(),
      name: name,
      type: $('m-type').value,
      category: $('m-category').value,
      locationId: locationId,
      widthCm: w.value,
      depthCm: d.value,
      heightCm: h.value,
      notes: notes.trim(),
      updatedAt: Date.now()
    };
    var errs = D.validateMeasurement(record, state.locations.map(function (l) { return l.id; }));
    if (errs.length) { showFieldError('err-dims', errs[0]); return; }

    try {
      await DB.putMeasurement(record);
      await reloadData();
      renderAll();
      $('measure-dialog').close();
      toast(state.editingId ? 'Measurement updated.' : 'Measurement saved.');
    } catch (e) {
      showFieldError('err-dims', 'Could not save: ' + (e && e.message ? e.message : 'storage error'));
    }
  }

  async function duplicateMeasurement(id) {
    var m = state.measurements.find(function (x) { return x.id === id; });
    if (!m) return;
    var copyName = (m.name + ' (copy)').slice(0, D.MAX_NAME);
    var copy = Object.assign({}, m, { id: D.newId(), name: copyName, updatedAt: Date.now() });
    try {
      await DB.putMeasurement(copy);
      await reloadData();
      renderAll();
      toast('Measurement duplicated.');
    } catch (e) { toast('Could not duplicate the measurement.'); }
  }

  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var dlg = $('confirm-dialog');
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      $('confirm-ok-btn').textContent = okLabel || 'Delete';
      var done = false;
      function finish(result) {
        if (done) return;
        done = true;
        dlg.removeEventListener('close', onClose);
        resolve(result);
      }
      function onClose() { finish(okClicked); }
      var okClicked = false;
      $('confirm-ok-btn').onclick = function () { okClicked = true; dlg.close(); };
      $('confirm-cancel-btn').onclick = function () { dlg.close(); };
      dlg.addEventListener('close', onClose);
      if (!dlg.open) dlg.showModal();
    });
  }

  async function deleteMeasurement(id) {
    var m = state.measurements.find(function (x) { return x.id === id; });
    if (!m) return;
    var ok = await confirmDialog('Delete measurement', 'Delete "' + m.name + '"? This cannot be undone.', 'Delete');
    if (!ok) return;
    try {
      await DB.deleteMeasurement(id);
      await reloadData();
      renderAll();
      toast('Measurement deleted.');
    } catch (e) { toast('Could not delete the measurement.'); }
  }

  /* ---------- locations ---------- */
  function openLocationDialog(id) {
    state.locationEditingId = id;
    var loc = id ? locationById(id) : null;
    $('location-dialog-title').textContent = loc ? 'Rename location' : 'Add location';
    $('location-save-btn').textContent = loc ? 'Save location' : 'Add location';
    $('loc-name').value = loc ? loc.name : '';
    showFieldError('err-loc-name', null);
    var dlg = $('location-dialog');
    if (!dlg.open) dlg.showModal();
    $('loc-name').focus();
  }

  async function saveLocationForm(ev) {
    ev.preventDefault();
    var name = $('loc-name').value.trim();
    if (!name) { showFieldError('err-loc-name', 'Location name is required.'); return; }
    if (name.length > D.MAX_NAME) { showFieldError('err-loc-name', 'Location name must be ' + D.MAX_NAME + ' characters or fewer.'); return; }
    var clash = state.locations.some(function (l) {
      return l.name.toLowerCase() === name.toLowerCase() && l.id !== state.locationEditingId;
    });
    if (clash) { showFieldError('err-loc-name', 'A location with that name already exists.'); return; }
    var record = { id: state.locationEditingId || D.newId(), name: name };
    try {
      await DB.putLocation(record);
      await reloadData();
      renderAll();
      $('location-dialog').close();
      /* If the measurement form is open, offer the new location there. */
      if ($('measure-dialog').open) {
        refreshLocationSelects();
        $('m-location').value = record.id;
      }
      toast(state.locationEditingId ? 'Location renamed.' : 'Location added.');
    } catch (e) {
      showFieldError('err-loc-name', 'Could not save: ' + (e && e.message ? e.message : 'storage error'));
    }
  }

  async function deleteLocation(id) {
    var loc = locationById(id);
    if (!loc) return;
    var count = countInLocation(id);
    if (count === 0) {
      var ok = await confirmDialog('Delete location', 'Delete the location "' + loc.name + '"?', 'Delete');
      if (!ok) return;
      await DB.deleteLocation(id);
      await reloadData();
      renderAll();
      toast('Location deleted.');
      return;
    }
    /* Nonempty: reassign or remove its measurements first. */
    state.locationDeleteId = id;
    $('reassign-text').textContent = 'The location "' + loc.name + '" has ' + count + ' measurement' + (count === 1 ? '' : 's') + '. Move them to another location, or delete them together with the location.';
    var others = state.locations.filter(function (l) { return l.id !== id; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    fillSelect($('reassign-target'), others.map(function (l) { return { value: l.id, label: l.name }; }));
    show($('reassign-target-wrap'), others.length > 0);
    document.querySelector('input[name="reassign-choice"][value="move"]').checked = true;
    showFieldError('err-reassign', null);
    var dlg = $('reassign-dialog');
    if (!dlg.open) dlg.showModal();
  }

  async function confirmReassign(ev) {
    ev.preventDefault();
    var id = state.locationDeleteId;
    if (!id) return;
    var choice = document.querySelector('input[name="reassign-choice"]:checked').value;
    var affected = state.measurements.filter(function (m) { return m.locationId === id; });
    try {
      if (choice === 'move') {
        var target = $('reassign-target').value;
        if (!target) { showFieldError('err-reassign', 'Choose a location to move the measurements to.'); return; }
        for (var i = 0; i < affected.length; i++) {
          await DB.putMeasurement(Object.assign({}, affected[i], { locationId: target }));
        }
      } else {
        for (var j = 0; j < affected.length; j++) {
          await DB.deleteMeasurement(affected[j].id);
        }
      }
      await DB.deleteLocation(id);
      await reloadData();
      renderAll();
      $('reassign-dialog').close();
      toast('Location deleted.');
    } catch (e) {
      showFieldError('err-reassign', 'Could not delete the location: ' + (e && e.message ? e.message : 'storage error'));
    }
  }

  function renderSettings() {
    $('setting-unit').value = settings.defaultUnit;
    $('setting-theme').value = settings.theme;
    $('setting-margin').value = String(settings.defaultMarginCm);
    var list = $('location-list');
    list.innerHTML = '';
    var locs = state.locations.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    show($('location-empty'), locs.length === 0);
    locs.forEach(function (loc) {
      var li = el('li', 'location-item');
      var left = el('div');
      left.appendChild(el('span', 'loc-name', loc.name));
      left.appendChild(el('span', 'loc-count', ' · ' + countInLocation(loc.id) + ' measurement' + (countInLocation(loc.id) === 1 ? '' : 's')));
      var actions = el('div', 'loc-actions');
      var renameBtn = el('button', 'btn btn-secondary btn-small', 'Rename');
      renameBtn.type = 'button';
      renameBtn.addEventListener('click', function () { openLocationDialog(loc.id); });
      var delBtn = el('button', 'btn btn-secondary btn-small', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () { deleteLocation(loc.id); });
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      li.appendChild(left);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  /* ---------- fit checker ---------- */
  function fitSource(which) {
    var radios = document.querySelectorAll('input[name="' + which + '-source"]');
    for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
    return 'saved';
  }

  function refreshFitOptions() {
    var spaces = state.measurements.filter(function (m) { return m.type === 'space'; });
    var items = state.measurements.filter(function (m) { return m.type === 'item'; });
    fillSelect($('space-select'),
      spaces.map(function (m) { return { value: m.id, label: m.name + ' — ' + D.formatDims(m, settings.defaultUnit) + ' (' + locationName(m.locationId) + ')' }; }),
      spaces.length ? 'Choose a space' : 'No saved spaces yet');
    fillSelect($('item-select'),
      items.map(function (m) { return { value: m.id, label: m.name + ' — ' + D.formatDims(m, settings.defaultUnit) + ' (' + locationName(m.locationId) + ')' }; }),
      items.length ? 'Choose an item' : 'No saved items yet');
    $('fit-margin').value = String(settings.defaultMarginCm);
    updateFitPreviews();
  }

  function savedDims(selectId) {
    var id = $(selectId).value;
    if (!id) return null;
    return state.measurements.find(function (m) { return m.id === id; }) || null;
  }

  function manualDims(prefix, unitId) {
    var unit = $(unitId).value;
    var w = parseDimInput($(prefix + '-w'), unit, true);
    var d = parseDimInput($(prefix + '-d'), unit, false);
    var h = parseDimInput($(prefix + '-h'), unit, false);
    if (w.error === 'required') return { dims: null, error: 'Enter a width.' };
    if (w.error || d.error || h.error) return { dims: null, error: 'Dimensions must be positive numbers.' };
    return { dims: { widthCm: w.value, depthCm: d.value, heightCm: h.value }, error: null };
  }

  function updateFitPreviews() {
    var sSrc = fitSource('space');
    var iSrc = fitSource('item');
    show($('space-select-wrap'), sSrc === 'saved');
    show($('space-manual'), sSrc === 'manual');
    show($('item-select-wrap'), iSrc === 'saved');
    show($('item-manual'), iSrc === 'manual');
    var s = sSrc === 'saved' ? savedDims('space-select') : null;
    $('space-preview').textContent = s ? D.formatDims(s, settings.defaultUnit) + ' · ' + locationName(s.locationId) : '';
    var it = iSrc === 'saved' ? savedDims('item-select') : null;
    $('item-preview').textContent = it ? D.formatDims(it, settings.defaultUnit) + ' · ' + locationName(it.locationId) : '';
  }

  function runFitCheck() {
    var marginRaw = $('fit-margin').value.trim();
    var margin = marginRaw === '' ? 0 : Number(marginRaw);
    if (!Number.isFinite(margin) || margin < 0) {
      renderFitResult({ status: 'error', message: 'Clearance margin must be 0 or more.' });
      return;
    }

    var space, item;
    if (fitSource('space') === 'saved') {
      space = savedDims('space-select');
      if (!space) { renderFitResult({ status: 'error', message: 'Choose a saved space, or switch to entering dimensions.' }); return; }
    } else {
      var sm = manualDims('space', 'space-unit');
      if (sm.error) { renderFitResult({ status: 'error', message: 'Space: ' + sm.error }); return; }
      space = sm.dims;
    }
    if (fitSource('item') === 'saved') {
      item = savedDims('item-select');
      if (!item) { renderFitResult({ status: 'error', message: 'Choose a saved item, or switch to entering dimensions.' }); return; }
    } else {
      var im = manualDims('item', 'item-unit');
      if (im.error) { renderFitResult({ status: 'error', message: 'Item: ' + im.error }); return; }
      item = im.dims;
    }

    var result = Fit.checkFit(
      { widthCm: space.widthCm, depthCm: space.depthCm, heightCm: space.heightCm },
      { widthCm: item.widthCm, depthCm: item.depthCm, heightCm: item.heightCm },
      margin
    );
    renderFitResult(result, margin);
  }

  function renderFitResult(result, margin) {
    var box = $('fit-result');
    box.innerHTML = '';
    show(box, true);
    var unit = settings.defaultUnit;

    if (result.status === 'error') {
      box.appendChild(el('div', 'fit-verdict incomplete', 'Cannot check'));
      box.appendChild(el('p', null, result.message));
      return;
    }
    if (result.status === 'incomplete') {
      box.appendChild(el('div', 'fit-verdict incomplete', 'Incomplete — cannot check fit'));
      box.appendChild(el('p', null, 'A full 3D comparison needs width, depth and height on both sides. Missing: ' + result.missing.join(', ') + '. Add the missing dimensions instead of guessing a fit.'));
      return;
    }

    var verdict = el('div', 'fit-verdict ' + (result.status === 'ok' ? 'ok' : 'fail'),
      result.status === 'ok' ? 'It fits' : 'It does not fit');
    box.appendChild(verdict);
    if (result.orientation === 'rotated') {
      box.appendChild(el('p', 'fit-orientation', 'Fits with a 90° horizontal rotation (item width and depth swapped).'));
    } else if (result.status === 'ok') {
      box.appendChild(el('p', 'fit-orientation', 'Fits in the normal orientation.'));
    } else {
      box.appendChild(el('p', 'fit-orientation', 'Best attempt shown (' + result.orientation + ' orientation). The item is too big on the dimensions below.'));
    }
    if (margin > 0) {
      box.appendChild(el('p', null, 'Clearances include a ' + D.formatValue(margin, unit) + ' ' + unit + ' margin on each side of the item.'));
    }

    var table = el('table', 'clearance-table');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, 'Dimension'));
    hr.appendChild(el('th', null, 'Clearance'));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    ['width', 'depth', 'height'].forEach(function (axis) {
      var tr = el('tr');
      tr.appendChild(el('td', null, axis.charAt(0).toUpperCase() + axis.slice(1)));
      var c = result.clearances[axis];
      var cell = el('td', c < 0 ? 'neg' : 'pos', (c < 0 ? '' : '+') + D.formatValue(c, unit) + ' ' + unit);
      tr.appendChild(cell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);

    if (result.status === 'fail') {
      box.appendChild(el('p', 'fit-blocking', 'Blocked by: ' + result.blocking.join(', ') + '.'));
    }
  }

  /* ---------- backup ---------- */
  function exportBackup() {
    var payload = {
      version: 1,
      app: 'measuremate',
      exportedAt: new Date().toISOString(),
      locations: state.locations,
      measurements: state.measurements
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'measuremate-backup.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup downloaded.');
  }

  async function importBackup(file) {
    showFieldError('import-error', null);
    $('import-success').hidden = true;
    var text;
    try { text = await file.text(); }
    catch (e) { showFieldError('import-error', 'Could not read the file.'); return; }
    var data;
    try { data = JSON.parse(text); }
    catch (e) { showFieldError('import-error', 'That file is not valid JSON. Your data was not changed.'); return; }
    var check = D.validateBackup(data);
    if (!check.ok) {
      showFieldError('import-error', 'Invalid backup — your data was not changed. ' + check.problems.slice(0, 3).join(' '));
      return;
    }
    try {
      await DB.replaceAll(data.locations, data.measurements);
      await reloadData();
      renderAll();
      var ok = $('import-success');
      ok.textContent = 'Backup imported: ' + data.measurements.length + ' measurements, ' + data.locations.length + ' locations.';
      ok.hidden = false;
      toast('Backup imported.');
    } catch (e) {
      showFieldError('import-error', 'Import failed and your data was not changed: ' + (e && e.message ? e.message : 'storage error'));
    }
  }

  /* ---------- render all ---------- */
  function renderAll() {
    refreshLocationSelects();
    renderDashboard();
    renderMeasurements();
    renderSettings();
    refreshFitOptions();
  }

  /* ---------- init ---------- */
  function init() {
    applyTheme(settings.theme);
    fillSelect($('filter-category'),
      [{ value: 'all', label: 'All categories' }].concat(D.CATEGORIES.map(function (c) { return { value: c, label: c }; })));
    fillSelect($('m-category'), D.CATEGORIES.map(function (c) { return { value: c, label: c }; }));

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { showSection(btn.getAttribute('data-section')); });
    });
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.menu-wrap')) closeAllMenus();
    });

    $('dash-add-btn').addEventListener('click', function () { openMeasureDialog(null); });
    $('empty-add-btn').addEventListener('click', function () { openMeasureDialog(null); });
    $('list-add-btn').addEventListener('click', function () { openMeasureDialog(null); });
    $('measure-form').addEventListener('submit', saveMeasurementForm);
    $('measure-cancel-btn').addEventListener('click', function () { $('measure-dialog').close(); });
    $('m-new-location-btn').addEventListener('click', function () { openLocationDialog(null); });

    $('location-form').addEventListener('submit', saveLocationForm);
    $('location-cancel-btn').addEventListener('click', function () { $('location-dialog').close(); });
    $('reassign-form').addEventListener('submit', confirmReassign);
    $('reassign-cancel-btn').addEventListener('click', function () { $('reassign-dialog').close(); });
    document.querySelectorAll('input[name="reassign-choice"]').forEach(function (r) {
      r.addEventListener('change', function () {
        show($('reassign-target-wrap'), r.value === 'move' && document.querySelector('input[name="reassign-choice"][value="move"]').checked);
      });
    });

    $('clear-filters-btn').addEventListener('click', function () {
      state.search = ''; state.typeFilter = 'all'; state.categoryFilter = 'all'; state.locationFilter = 'all'; state.sort = 'newest';
      $('search-input').value = '';
      $('filter-type').value = 'all'; $('filter-category').value = 'all'; $('filter-location').value = 'all'; $('sort-select').value = 'newest';
      renderMeasurements();
    });
    $('search-input').addEventListener('input', function () { state.search = $('search-input').value; renderMeasurements(); });
    $('filter-type').addEventListener('change', function () { state.typeFilter = $('filter-type').value; renderMeasurements(); });
    $('filter-category').addEventListener('change', function () { state.categoryFilter = $('filter-category').value; renderMeasurements(); });
    $('filter-location').addEventListener('change', function () { state.locationFilter = $('filter-location').value; renderMeasurements(); });
    $('sort-select').addEventListener('change', function () { state.sort = $('sort-select').value; renderMeasurements(); });

    document.querySelectorAll('input[name="space-source"]').forEach(function (r) { r.addEventListener('change', updateFitPreviews); });
    document.querySelectorAll('input[name="item-source"]').forEach(function (r) { r.addEventListener('change', updateFitPreviews); });
    $('space-select').addEventListener('change', updateFitPreviews);
    $('item-select').addEventListener('change', updateFitPreviews);
    $('check-fit-btn').addEventListener('click', runFitCheck);
    $('clear-fit-btn').addEventListener('click', function () {
      show($('fit-result'), false);
      $('fit-margin').value = String(settings.defaultMarginCm);
      ['space-w', 'space-d', 'space-h', 'item-w', 'item-d', 'item-h'].forEach(function (id) { $(id).value = ''; });
    });

    $('save-settings-btn').addEventListener('click', function () {
      var marginRaw = $('setting-margin').value.trim();
      var margin = marginRaw === '' ? 0 : Number(marginRaw);
      if (!Number.isFinite(margin) || margin < 0) {
        showFieldError('settings-error', 'Default clearance margin must be 0 or more.');
        return;
      }
      showFieldError('settings-error', null);
      settings.defaultUnit = $('setting-unit').value;
      settings.theme = $('setting-theme').value;
      settings.defaultMarginCm = margin;
      saveSettings(settings);
      applyTheme(settings.theme);
      renderAll();
      toast('Preferences saved.');
    });
    $('add-location-btn').addEventListener('click', function () { openLocationDialog(null); });
    $('export-btn').addEventListener('click', exportBackup);
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      if ($('import-file').files.length) importBackup($('import-file').files[0]);
      $('import-file').value = '';
    });
    $('clear-all-btn').addEventListener('click', function () {
      $('clearall-input').value = '';
      showFieldError('err-clearall', null);
      var dlg = $('clearall-dialog');
      if (!dlg.open) dlg.showModal();
    });
    $('clearall-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if ($('clearall-input').value.trim() !== 'DELETE') {
        showFieldError('err-clearall', 'Type DELETE exactly to confirm.');
        return;
      }
      try {
        await DB.clearAll();
        await reloadData();
        renderAll();
        $('clearall-dialog').close();
        toast('All data deleted.');
      } catch (e) {
        showFieldError('err-clearall', 'Could not delete: ' + (e && e.message ? e.message : 'storage error'));
      }
    });
    $('clearall-cancel-btn').addEventListener('click', function () { $('clearall-dialog').close(); });

    reloadData().then(function () {
      renderAll();
      showSection('dashboard');
    }).catch(function (e) {
      state.dbFailed = true;
      var banner = $('db-error');
      banner.textContent = 'Storage is unavailable in this browser (' + (e && e.message ? e.message : 'IndexedDB error') + '). Measurements cannot be saved.';
      banner.hidden = false;
      renderAll();
      showSection('dashboard');
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support optional */ });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
