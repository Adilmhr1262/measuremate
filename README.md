# MeasureMate

**Measure your space. Know what fits.**

MeasureMate is a private, offline-first measurement organizer. Record the
dimensions of rooms, furniture, doors, windows and appliances, then check
whether a new piece of furniture will fit in a space — including a 90°
rotation and a configurable clearance margin.

## Features

- **Measurement manager** — name, type (Available Space / Item), category,
  user-defined location, width (required), depth and height (optional),
  units (cm, m, inches, feet), notes. Dimensions are stored in centimetres
  and converted only for entry and display.
- **Locations** — add, rename and delete locations. A location with
  measurements can only be deleted after moving its measurements elsewhere
  or deleting them with it, so no record is ever orphaned.
- **Fit Checker** — compare a saved space with a saved item, or enter
  dimensions directly. Shows a clear fit verdict, clearance per dimension
  (including negative clearance on a failed fit), which dimension blocks
  the fit, and whether a 90° rotation makes it fit. A clearance margin
  (default 0 cm) is applied to each side of the item. Incomplete 3D
  comparisons are rejected instead of claiming a fit. A fit is
  dimensional only: doorways, turning paths, stairs and irregular shapes
  are not modelled.
- **Search and organization** — instant name search, type / category /
  location filters, sorting by name or updated date. Measurements are
  grouped by location, with Edit, Duplicate and Delete on each card.
- **Backup** — JSON export and import with full schema validation,
  duplicate-ID rejection and atomic replacement, so a bad file never
  partially overwrites your data.
- **Offline-first** — IndexedDB storage, a service worker caches the app
  for offline use, and a manifest makes it installable. No account,
  analytics, tracking or backend. Starts completely empty.

## Files

- `index.html` — app shell and all four sections
- `styles.css` — deep teal / warm white theme, light and dark mode
- `app.js` — UI wiring
- `db.js` — IndexedDB wrapper
- `measurements.js` — units, validation, formatting
- `fit-checker.js` — pure fit logic
- `manifest.webmanifest`, `sw.js` — installable offline support

## Run locally

Serve the folder over HTTP (service workers need a secure context) and
open `index.html`, for example:

```sh
python3 -m http.server 8000
```

## Tests

`tests/measuremate-test.js` runs the acceptance suite in headless Firefox
via playwright-core. It needs the `playwright-core` package and a Firefox
binary available to it.
