# GeoPhotos

Manual geotagging of photos on a map for Windows, modelled on the Map module of Adobe Lightroom.

You open a folder from a trip, see the photos that already have coordinates (usually the ones from the phone) on the map, find where every other shot was taken and drag its thumbnail there. Then you save, and the coordinates are written into the files, or into XMP sidecars for RAW, so that Lightroom, Immich and other programs read them.

## Features

- **Map:** OpenStreetMap, Esri satellite and Google satellite imagery. Nearby markers are grouped.
- **Place search:** by name or address, through Nominatim.
- **Thumbnail strip:** sorted by shooting date. Marks show photos with coordinates and unsaved changes.
- **Ways to set coordinates:**
  - drag thumbnails from the strip onto the map;
  - drag them onto a photo that already has coordinates;
  - drag a marker on the map.
- **Selection:** click, Ctrl+click, Shift+click, Ctrl+A. Arrow keys move through the photos.
- **Filters:** all photos, photos with coordinates, modified photos — as buttons in the status bar and in the View menu.
- **Photo view (Space):** a large preview in place of the map.
- **Save:** *Save* writes all modified photos, *Save Selected* only the selected ones. Progress is shown, and a list of files that could not be written appears at the end. You are warned about unsaved changes.
- **Log:** every write is logged with its old and new coordinates, so they can be restored by hand.
- **Interface:** English, Russian and Ukrainian. New languages are added as files, without code changes.
- **Next start:** the program reopens the last folder and photo.

### Where coordinates are written

Only latitude and longitude are written. Altitude and other tags are not touched.

| Format | Written to |
|---|---|
| JPEG, HEIC/HEIF, AVIF, PNG, WebP, TIFF, DNG | EXIF inside the file; the embedded XMP and an existing sidecar are updated too if they already hold coordinates |
| Other RAW (CR2, CR3, NEF, ARW, RAF, ORF, RW2, …) | Only the XMP sidecar, Lightroom-style (`IMG_0001.CR2` → `IMG_0001.xmp`). An existing sidecar is updated with its other contents kept. The RAW file is never modified |

No `*_original` backup copies are left. Read-only files are reported and skipped.

When coordinates exist in several places, they are read in this order: XMP sidecar, embedded XMP, EXIF.

## Requirements

- Windows 10 or 11.
- [ExifTool](https://exiftool.org/) (checked with 13.62). Put it in `PATH`, or set `exiftoolPath` in the settings file.
- Internet access for map tiles and place search.

## Running from source

Requires [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
npm run dev
```

Build the program (output: `dist/win-unpacked/GeoPhotos.exe`):

```bash
npm run build
```

A folder or a photo can be passed on the command line: `GeoPhotos.exe "D:\Photos\Trip"`.

## Settings and logs

- **Settings:** `%APPDATA%\GeoPhotos\settings.json`, created by *File → Open Settings File* with every option and its description. The file is JSONC with a JSON Schema, so editors such as VS Code show hints and check values. Changes apply after a restart.
- **Logs:** `%APPDATA%\GeoPhotos\logs`.

*Help → About* links to both.

## Map tiles

The OpenStreetMap and Esri tiles are used under their usage policies. The Google satellite layer loads tiles from direct URLs, which Google's terms do not allow, and it may stop working at any time. It can be removed from the settings (`map.tileSources`).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run typecheck` | Type-check the main process, preload, tests and the window |
| `npm test` | Unit tests |
| `npm run test:integration` | Tests with the real ExifTool on copies of files |
| `npm run build` | Build the program |

Some integration tests use real photos that are not in the repository. Set `GEOPHOTOS_TEST_DIR` to a folder of test photos, or they are taken from `../data/geophotos-testdata/master`. Without them, those tests are skipped.

**Stack:** Electron, TypeScript, electron-vite, Leaflet with Leaflet.markercluster, sharp, Vitest. ExifTool runs as a single `-stay_open` process.

**Code layout:**
- `src/main` — main process: files, ExifTool, menu, saving.
- `src/renderer` — the window: map, strip, status bar.
- `src/preload` — the bridge between the window and the main process.
- `src/shared` — logic shared by both, unit-tested without Electron.

**Project documents (in Russian):**
- `tz.md` — requirements.
- `make-project.md` — technical decisions and the working process.
- `CHANGELOG.md` — the history of versions.

## License

[MIT](LICENSE). The built program also carries THIRD-PARTY-NOTICES.txt with the licenses of the components it includes (made by `scripts/third-party-notices.mjs` during the build); *Help → About* links to both.
