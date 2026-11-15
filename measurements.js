/* MeasureMate — measurements.js
   Domain logic for measurements and locations: units, validation,
   formatting. All dimensions are stored internally in centimetres. */
(function () {
  'use strict';

  var UNITS = {
    cm: { label: 'cm', toCm: 1 },
    m: { label: 'm', toCm: 100 },
    in: { label: 'in', toCm: 2.54 },
    ft: { label: 'ft', toCm: 30.48 }
  };
  var UNIT_IDS = ['cm', 'm', 'in', 'ft'];
  var CATEGORIES = ['Room', 'Furniture', 'Doorway', 'Window', 'Appliance', 'Other'];
  var TYPES = { space: 'Available Space', item: 'Item' };

  var MAX_NAME = 80;
  var MAX_NOTES = 500;
  var MAX_DIM_CM = 100000; /* 1 km: guards against absurd values */

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* Convert a value entered in `unit` to centimetres, rounded to 4 dp
     to keep float noise out of stored values. Returns NaN when invalid. */
  function toCm(value, unit) {
    var n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    var factor = UNITS[unit] ? UNITS[unit].toCm : NaN;
    if (!Number.isFinite(factor)) return NaN;
    return Math.round(n * factor * 10000) / 10000;
  }

  /* Convert stored centimetres to `unit` for display. */
  function fromCm(cm, unit) {
    var factor = UNITS[unit] ? UNITS[unit].toCm : 1;
    return cm / factor;
  }

  /* Format a stored cm value in `unit`, max 2 decimals, no trailing zeros. */
  function formatValue(cm, unit) {
    var v = fromCm(cm, unit);
    var rounded = Math.round(v * 100) / 100;
    return String(rounded);
  }

  /* "180 × 80 × 75 cm" — omits depth/height when not recorded. */
  function formatDims(m, unit) {
    var parts = [formatValue(m.widthCm, unit)];
    if (m.depthCm !== null && m.depthCm !== undefined) parts.push(formatValue(m.depthCm, unit));
    if (m.heightCm !== null && m.heightCm !== undefined) parts.push(formatValue(m.heightCm, unit));
    return parts.join(' × ') + ' ' + unit;
  }

  function isValidDimCm(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_DIM_CM;
  }

  /* Validate one raw measurement record (as stored). Returns an array of
     human-readable problems; empty means valid. */
  function validateMeasurement(m, knownLocationIds) {
    var problems = [];
    if (!m || typeof m !== 'object') return ['Measurement is not an object.'];
    if (typeof m.id !== 'string' || m.id.length === 0) problems.push('Missing measurement id.');
    if (typeof m.name !== 'string' || m.name.trim().length === 0) {
      problems.push('Name is required.');
    } else if (m.name.length > MAX_NAME) {
      problems.push('Name must be ' + MAX_NAME + ' characters or fewer.');
    }
    if (m.type !== 'space' && m.type !== 'item') problems.push('Type must be Available Space or Item.');
    if (CATEGORIES.indexOf(m.category) === -1) problems.push('Category is not recognised.');
    if (typeof m.locationId !== 'string' || m.locationId.length === 0) {
      problems.push('Location is required.');
    } else if (knownLocationIds && knownLocationIds.indexOf(m.locationId) === -1) {
      problems.push('Location does not exist.');
    }
    if (!isValidDimCm(m.widthCm)) problems.push('Width must be a positive number.');
    if (m.depthCm !== null && m.depthCm !== undefined && !isValidDimCm(m.depthCm)) {
      problems.push('Depth must be a positive number when given.');
    }
    if (m.heightCm !== null && m.heightCm !== undefined && !isValidDimCm(m.heightCm)) {
      problems.push('Height must be a positive number when given.');
    }
    if (m.notes !== undefined && m.notes !== null) {
      if (typeof m.notes !== 'string') problems.push('Notes must be text.');
      else if (m.notes.length > MAX_NOTES) problems.push('Notes must be ' + MAX_NOTES + ' characters or fewer.');
    }
    if (typeof m.updatedAt !== 'number' || !Number.isFinite(m.updatedAt)) {
      problems.push('Updated time is missing or invalid.');
    }
    return problems;
  }

  function validateLocation(loc) {
    var problems = [];
    if (!loc || typeof loc !== 'object') return ['Location is not an object.'];
    if (typeof loc.id !== 'string' || loc.id.length === 0) problems.push('Missing location id.');
    if (typeof loc.name !== 'string' || loc.name.trim().length === 0) {
      problems.push('Location name is required.');
    } else if (loc.name.length > MAX_NAME) {
      problems.push('Location name must be ' + MAX_NAME + ' characters or fewer.');
    }
    return problems;
  }

  /* Validate a whole backup payload before any write. Returns
     { ok: true } or { ok: false, problems: [...] }. Nothing is written here. */
  function validateBackup(data) {
    var problems = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, problems: ['Backup file is not a JSON object.'] };
    }
    if (data.version !== 1) problems.push('Backup version is not supported (expected 1).');
    if (!Array.isArray(data.locations)) problems.push('Backup has no locations list.');
    if (!Array.isArray(data.measurements)) problems.push('Backup has no measurements list.');
    if (problems.length) return { ok: false, problems: problems };

    var seenLoc = {};
    data.locations.forEach(function (loc, i) {
      validateLocation(loc).forEach(function (p) { problems.push('Location ' + (i + 1) + ': ' + p); });
      if (typeof loc.id === 'string') {
        if (seenLoc[loc.id]) problems.push('Duplicate location id: ' + loc.id);
        seenLoc[loc.id] = true;
      }
    });
    var locIds = Object.keys(seenLoc);
    var seenMea = {};
    data.measurements.forEach(function (m, i) {
      validateMeasurement(m, locIds).forEach(function (p) { problems.push('Measurement ' + (i + 1) + ': ' + p); });
      if (typeof m.id === 'string') {
        if (seenMea[m.id]) problems.push('Duplicate measurement id: ' + m.id);
        seenMea[m.id] = true;
      }
    });
    return problems.length ? { ok: false, problems: problems } : { ok: true };
  }

  function formatUpdated(ts) {
    var d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  window.MeasureMateDomain = {
    UNITS: UNITS,
    UNIT_IDS: UNIT_IDS,
    CATEGORIES: CATEGORIES,
    TYPES: TYPES,
    MAX_NAME: MAX_NAME,
    MAX_NOTES: MAX_NOTES,
    newId: newId,
    toCm: toCm,
    fromCm: fromCm,
    formatValue: formatValue,
    formatDims: formatDims,
    isValidDimCm: isValidDimCm,
    validateMeasurement: validateMeasurement,
    validateLocation: validateLocation,
    validateBackup: validateBackup,
    formatUpdated: formatUpdated
  };
})();
