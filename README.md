# GeoPhotos

**English** | [Русский](README.ru.md) | [Українська](README.uk.md)

Manual geotagging of photos on a map for Windows, modelled on the Map module of Adobe Lightroom.

You open a folder from a trip, see the photos that already have coordinates (usually the ones from the phone) on the map, find where every other shot was taken and drag its thumbnail there. Then you save, and the coordinates are written into the files, or into XMP sidecars for RAW, so that Lightroom, Immich and other programs read them.

## Installation

GeoPhotos needs no installer: it is a folder you copy to your computer.

1. Download `GeoPhotos-<version>-win-x64.zip` from the [latest release](https://github.com/rejgan318/geophotos/releases/latest) (Assets at the bottom of the page).
2. Unpack it anywhere you can write to, for example `C:\Programs` or `D:\Tools` (right-click → *Extract All…*). A folder `GeoPhotos` appears. A folder you can write to is better than `C:\Program Files`: ExifTool can then be put right next to the program (step 4).
3. Run `GeoPhotos.exe` from that folder. To start it more easily, right-click it → *Send to → Desktop (create shortcut)*, or pin it to Start.
   The program is not signed, so on the first start Windows may show *"Windows protected your PC"*: click *More info → Run anyway*.
4. GeoPhotos uses [ExifTool](https://exiftool.org/) to read and write coordinates. If ExifTool is not on the computer, GeoPhotos says so at the first start: click **Install for GeoPhotos** — it downloads the official ExifTool (about 11 MB) from exiftool.org, checks it and puts it next to `GeoPhotos.exe`. Other ways are under [Requirements](#requirements).
5. Open a folder of photos: *File → Open Folder…* (pick any photo in it), or drag the folder onto the window.

**Update:** unpack the new zip over the old folder (or into a new one). Settings, recent folders and logs are kept in `%APPDATA%\GeoPhotos` and stay. If ExifTool was installed next to the old `GeoPhotos.exe` and you use a new folder, copy `exiftool.exe` and `exiftool_files` over, or click **Install for GeoPhotos** again.

**Uninstall:** delete the `GeoPhotos` folder; to remove the settings and logs too, delete `%APPDATA%\GeoPhotos`.

## Features

- **Folder and separate files:** *File → Open Folder…* (Ctrl+O) or dropping a folder shows the whole folder; *File → Add Files…* (Ctrl+Shift+O) or dropping files adds them to what is already in the strip, so photos from several folders (say, the camera's and the phone's) can be placed together. Del takes the selected photos or track off the strip (the files stay).
- **Tracks** (GPX, KML, KMZ, FIT, TCX, GeoJSON — from watches, navigators, apps): in the strip by their start time, with their shape as the thumbnail; on the map as lines in distinct colours, with waypoints as flags. Hovering a line shows the time of that point (local time of the place), the altitude and, when the file has them, heart rate, speed, cadence, temperature, power. Space on a track shows its summary (distance, time moving, stops, speeds, ascent and descent, heart rate) and its altitude profile over the dimmed map.
- **Map:** OpenStreetMap, Esri satellite, Google satellite and OpenTopoMap. Nearby markers are grouped. Markers or photo thumbnails on the map (key T); hovering a marker shows its thumbnail.
- **Place search:** by name or address, through Nominatim.
- **Thumbnail strip:** sorted by shooting date. Marks show photos with coordinates, an address, an altitude, and unsaved changes. Photos of subfolders can be loaded too.
- **Ways to set coordinates:**
  - drag thumbnails from the strip onto the map, or double-click the map for the current photo;
  - drag a photo onto another one in the strip (both ways: the one without coordinates gets them);
  - drag a marker on the map;
  - Ctrl+V coordinates copied from Google Maps and the like, or Ctrl+C / Ctrl+V between photos (with the address and altitude);
  - Ctrl+Del removes coordinates, address and altitude.
- **Selection:** click, Ctrl+click, Shift+click, Ctrl+A; Ctrl+drag on the map selects the photos in a rectangle. Arrow keys move through the photos. Dragging the marker of one of several selected photos moves them all to that point.
- **Filters:** all photos, with coordinates, without coordinates, modified — as buttons in the status bar and in the View menu.
- **Address and altitude** (*Tools → Get Address / Get Altitude*): the address from Nominatim (OpenStreetMap) in the interface language, the altitude from the Open-Meteo Elevation API, for every photo of the folder that has coordinates. Points the service did not answer are asked again in the background.
- **Photo view (Space):** a large preview in place of the map.
- **Save:** *Save* writes all modified photos, *Save Selected* only the selected ones. Progress is shown, and a list of files that could not be written appears at the end. You are warned about unsaved changes.
- **Log:** every write is logged with its old and new coordinates, so they can be restored by hand.
- **Interface:** English, Russian and Ukrainian (*Tools → Language*). New languages are added as files, without code changes.
- **File → Refresh (F5):** reads the folder and the added files again after they were changed outside; the view stays.
- **Batch mode:** addresses and altitudes for whole folders from the command line (see below).
- **Next start:** the program reopens the last folder with the added files and the current photo, the window, the map and its mode.

### Where coordinates are written

Latitude and longitude, the altitude, and the address (country, country code, state, city, street) are written. Other tags are not touched. When coordinates change, the old address and altitude are removed.

| Format | Written to |
|---|---|
| JPEG, HEIC/HEIF, AVIF, PNG, WebP, TIFF, DNG | Coordinates and altitude: EXIF inside the file; the embedded XMP and an existing sidecar are updated too if they already hold coordinates. Address: XMP of the file and of an existing sidecar (old IPTC place names are removed) |
| Other RAW (CR2, CR3, NEF, ARW, RAF, ORF, RW2, …) | Only the XMP sidecar, Lightroom-style (`IMG_0001.CR2` → `IMG_0001.xmp`). An existing sidecar is updated with its other contents kept. The RAW file is never modified |

No `*_original` backup copies are left. Read-only files are reported and skipped.

When coordinates exist in several places, they are read in this order: XMP sidecar, embedded XMP, EXIF.

Videos (MOV, MP4, AVI, MPG, MTS, MKV, WMV and other formats exiftool reads) are shown in the strip with the thumbnail Windows Explorer shows, and on the map when they have coordinates (from the phone's QuickTime metadata, the XMP sidecar, or the first point of a GPS track). Space shows a large frame and an "Open in Player" button. Videos are placed like photos: MOV, MP4 and the rest of the QuickTime family get the coordinates in the file itself (where phones keep them), the other formats in an XMP sidecar; the file time of a video is kept.

Live photos (iPhone Live Photo; Motion Photo of Google, Xiaomi, Samsung) are one thumbnail in the strip; the short video plays on hover. For an iPhone pair, the coordinates are written to both the photo and the MOV.

## Requirements

- Windows 10 or 11, 64-bit.
- [ExifTool](https://exiftool.org/) (checked with 13.62 and 13.64). If GeoPhotos does not find it at start, it offers **Install for GeoPhotos**: it downloads the official Windows zip, checks its SHA-256 against exiftool.org and puts exiftool next to `GeoPhotos.exe`. Or any of:
  - install it with the Windows installer (or `winget install OliverBetz.ExifTool`); GeoPhotos finds it in `PATH` or where the installer puts it;
  - put it next to `GeoPhotos.exe`: `exiftool.exe` **together with its folder `exiftool_files`** (the exe alone does not run). From the zip of exiftool.org rename `exiftool(-k).exe` to `exiftool.exe`;
  - set `exiftoolPath` in the settings file to the full path of `exiftool.exe`.
  The path of the settings is tried first; the usual places only when it does not run.
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

Folders and files can be passed on the command line, as when they are dropped onto the window: `GeoPhotos.exe "D:\Photos\Trip"` opens the folder, `GeoPhotos.exe "D:\Phone\IMG_1.jpg" "D:\Phone\IMG_2.jpg"` adds the files.

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

- **Settings:** `%APPDATA%\GeoPhotos\settings.json`, created by *Tools → Open Settings File* with every option and its description. The file is JSONC with a JSON Schema, so editors such as VS Code show hints and check values. Changes apply after a restart.
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
