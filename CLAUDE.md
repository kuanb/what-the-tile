# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

what-the-tile is a browser-based map tool for visualizing slippy map tile boundaries at each zoom level. Users can search tiles by quadkey, click tiles to copy their quadkey to clipboard, and use a geocoder to navigate. Deployed as a static site via GitHub Pages.

## Commands

- `npm run dev` — local dev server with live reload (uses budo)
- `npm run build` — bundle `src/index.js` → `static/bundle.js` (browserify)
- `npm run publish` — deploy `static/` directory to GitHub Pages (requires gh-pages installed globally)

## Architecture

Single-file app (`src/index.js`) bundled with browserify into `static/bundle.js`, served alongside `static/index.html`.

**Key libraries:**
- `mapbox-gl` — map rendering
- `@mapbox/tilebelt` — tile ↔ quadkey ↔ GeoJSON conversions
- `@mapbox/tile-cover` — computes which tiles cover the current viewport
- `@turf/turf` — loaded via CDN in index.html (not bundled), used for `turf.area()` calculations

**Data flow:** On map load and every `moveend` event, `updateTiles()` computes visible tiles at `Math.ceil(zoom)`, generates GeoJSON features for tile boundaries and center labels, and updates two map sources (`tiles-geojson`, `tiles-centers-geojson`). The quadkey search control (`QuadkeySearchControl`) converts a quadkey input to a tile bounding box and flies the map there.

**No test suite or linter is configured.**
