/* MeasureMate — fit-checker.js
   Pure fit logic. Space and item are { widthCm, depthCm, heightCm }
   with null for any dimension not recorded. `marginCm` is the clearance
   margin applied to EACH SIDE of the item on all three axes, so the
   item's effective size on an axis is dim + 2 * margin.
   Returns:
     { status: 'ok' | 'fail' | 'incomplete',
       orientation: 'normal' | 'rotated' | null,
       clearances: { width, depth, height } | null,   // cm, may be negative
       blocking: ['width' | 'depth' | 'height'],      // axes that prevent fit
       missing: ['width' | 'depth' | 'height'] }      // axes not supplied
   A dimensional fit says nothing about delivery: doorways, turning
   paths, stairs and irregular shapes are not modelled. */
(function () {
  'use strict';

  var AXES = ['width', 'depth', 'height'];

  function axisKey(axis) { return axis + 'Cm'; }

  function checkOrientation(space, item, marginCm, rotated) {
    var clearances = {};
    var blocking = [];
    var minClearance = Infinity;
    AXES.forEach(function (axis) {
      var itemDim = item[axisKey(axis)];
      if (rotated && axis === 'width') itemDim = item.depthCm;
      if (rotated && axis === 'depth') itemDim = item.widthCm;
      var c = space[axisKey(axis)] - (itemDim + 2 * marginCm);
      clearances[axis] = Math.round(c * 10000) / 10000;
      if (c < 0) blocking.push(axis);
      if (c < minClearance) minClearance = c;
    });
    return { clearances: clearances, blocking: blocking, minClearance: minClearance };
  }

  function checkFit(space, item, marginCm) {
    if (typeof marginCm !== 'number' || !Number.isFinite(marginCm) || marginCm < 0) {
      marginCm = 0;
    }
    var missing = [];
    AXES.forEach(function (axis) {
      if (space[axisKey(axis)] === null || space[axisKey(axis)] === undefined) missing.push(axis + ' (space)');
      if (item[axisKey(axis)] === null || item[axisKey(axis)] === undefined) missing.push(axis + ' (item)');
    });
    if (missing.length) {
      return { status: 'incomplete', orientation: null, clearances: null, blocking: [], missing: missing };
    }

    var normal = checkOrientation(space, item, marginCm, false);
    if (normal.blocking.length === 0) {
      return { status: 'ok', orientation: 'normal', clearances: normal.clearances, blocking: [], missing: [] };
    }
    var rotated = checkOrientation(space, item, marginCm, true);
    if (rotated.blocking.length === 0) {
      return { status: 'ok', orientation: 'rotated', clearances: rotated.clearances, blocking: [], missing: [] };
    }
    /* Neither orientation fits: report the better one (largest worst clearance). */
    var best = normal.minClearance >= rotated.minClearance
      ? { orientation: 'normal', result: normal }
      : { orientation: 'rotated', result: rotated };
    return {
      status: 'fail',
      orientation: best.orientation,
      clearances: best.result.clearances,
      blocking: best.result.blocking,
      missing: []
    };
  }

  window.MeasureMateFit = { checkFit: checkFit, AXES: AXES };
})();
