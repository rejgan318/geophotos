# GeoPhotos

Manual geotagging of photos on a map for Windows, modelled on the Map module of Adobe Lightroom.

You open a folder from a trip, see the photos that already have coordinates (usually the ones from the phone) on the map, find where every other shot was taken and drag its thumbnail there. Then you save, and the coordinates are written into the files, or into XMP sidecars for RAW, so that Lightroom, Immich and other programs read them.

## Features

- **Map:** OpenStreetMap, Esri satellite, Google satellite and OpenTopoMap. Nearby markers are grouped. Markers or photo thumbnails on the map (key T); hovering a marker shows its thumbnail.
- **Place search:** by name or address, through Nominatim.
- **Thumbnail strip:** sorted by shooting date. Marks show photos with coordinates, an address, an altitude, and unsaved changes. Photos of subfolders can be loaded too.
- **Ways to set coordinates:**
  - drag thumbnails from the strip onto the map, or double-click the map for the current photo;
  - drag a photo onto another one in the strip (both ways: the one without coordinates gets them);
  - drag a marker on the map;
  - Ctrl+V coordinates copied from Google Maps and the like, or Ctrl+C / Ctrl+V between photos (with the address and altitude);
  - Del removes coordinates, address and altitude.
- **Selection:** click, Ctrl+click, Shift+click, Ctrl+A; Ctrl+drag on the map selects the photos in a rectangle. Arrow keys move through the photos. Dragging the marker of one of several selected photos moves them all to that point.
- **Filters:** all photos, with coordinates, without coordinates, modified — as buttons in the status bar and in the View menu.
- **Address and altitude** (*Tools → Get Address / Get Altitude*): the address from Nominatim (OpenStreetMap) in the interface language, the altitude from the Open-Meteo Elevation API, for every photo of the folder that has coordinates. Points the service did not answer are asked again in the background.
- **Photo view (Space):** a large preview in place of the map.
- **Save:** *Save* writes all modified photos, *Save Selected* only the selected ones. Progress is shown, and a list of files that could not be written appears at the end. You are warned about unsaved changes.
- **Log:** every write is logged with its old and new coordinates, so they can be restored by hand.
- **Interface:** English, Russian and Ukrainian. New languages are added as files, without code changes.
- **File → Refresh (F5):** reads the folder again after it was changed outside; the view stays.
- **Batch mode:** addresses and altitudes for whole folders from the command line (see below).
- **Next start:** the program reopens the last folder and photo, the window, the map and its mode.

### Where coordinates are written

Latitude and longitude, the altitude, and the address (country, country code, state, city, street) are written. Other tags are not touched. When coordinates change, the old address and altitude are removed.

| Format | Written to |
|---|---|
| JPEG, HEIC/HEIF, AVIF, PNG, WebP, TIFF, DNG | Coordinates and altitude: EXIF inside the file; the embedded XMP and an existing sidecar are updated too if they already hold coordinates. Address: XMP of the file and of an existing sidecar (old IPTC place names are removed) |
| Other RAW (CR2, CR3, NEF, ARW, RAF, ORF, RW2, …) | Only the XMP sidecar, Lightroom-style (`IMG_0001.CR2` → `IMG_0001.xmp`). An existing sidecar is updated with its other contents kept. The RAW file is never modified |

No `*_original` backup copies are left. Read-only files are reported and skipped.

When coordinates exist in several places, they are read in this order: XMP sidecar, embedded XMP, EXIF.

Videos (MOV, MP4, AVI, MPG, MTS, MKV, WMV and other formats exiftool reads) are shown in the strip with the thumbnail Windows Explorer shows, and on the map when they have coordinates (from the phone's QuickTime metadata, the XMP sidecar, or the first point of a GPS track). Space shows a large frame and an "Open in Player" button. Videos are placed like photos: MOV, MP4 and the rest of the QuickTime family get the coordinates in the file itself (where phones keep them), the other formats in an XMP sidecar; the file time of a video is kept.

## Requirements

- Windows 10 or 11.
- [ExifTool](https://exiftool.org/) (checked with 13.62). Put it in `PATH`, or set `exiftoolPath` in the settings file.
- Internet access for map tiles, place search, addresses and altitudes.

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

## Batch mode

Addresses and altitudes for many photos at once, without the main window:

```
GeoPhotos.exe --batch [--no-address] [--no-altitude] [--subfolders] [--overwrite] <folder | file ...>
```

| Option | Meaning |
|---|---|
| `--no-address` | Do not get addresses (by default they are got) |
| `--no-altitude` | Do not get altitudes (by default they are got) |
| `--subfolders` | Process the folders with all their subfolders |
| `--overwrite` | Replace an address or altitude a photo already has (by default such photos are skipped) |

Only photos with coordinates are processed. Each point is asked once (points the service did not answer are asked again at the end, twice); addresses come at most one per second (Nominatim's rule), altitudes up to 100 points per request. The results are written straight into the files.

A small window shows what is being done, a progress bar (also on the taskbar icon), about how long is left, and *Cancel*. Cancel during the requests keeps and writes what was already received. At the end it shows how many photos were written, skipped and failed (with the list of errors); with no errors it closes by itself after 10 seconds. Details go to the log.

Exit code: `0` — done, `1` — some photos failed, `2` — wrong parameters, `3` — cancelled.

Examples:

```
GeoPhotos.exe --batch "D:\Photos\Trip"
GeoPhotos.exe --batch --subfolders --no-address "D:\Photos\2024"
GeoPhotos.exe --batch --overwrite "D:\Photos\Trip\IMG_0001.CR2" "D:\Photos\Trip\IMG_0002.CR2"
```

The same window is used when the program is closed while addresses or altitudes are still being received and you choose to finish them in the background.

## Settings and logs

- **Settings:** `%APPDATA%\GeoPhotos\settings.json`, created by *File → Open Settings File* with every option and its description. The file is JSONC with a JSON Schema, so editors such as VS Code show hints and check values. Changes apply after a restart.
- **Logs:** `%APPDATA%\GeoPhotos\logs`.

*Tools* has *Open Settings File* and *Open Log Folder*.

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

[MIT](LICENSE). The built program also carries THIRD-PARTY-NOTICES.txt with the licenses of the components it includes (made by `scripts/third-party-notices.mjs` during the build); *Help → About* links to both. Altitudes come from Open-Meteo (open-meteo.com), based on Copernicus DEM GLO-90; addresses and place search from Nominatim, © OpenStreetMap contributors.
