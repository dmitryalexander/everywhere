# Everywhere

**Your files, everywhere. A visual browser for [voidtools Everything](https://www.voidtools.com/).**

Turn Everything's fast filename search into a wall of images, videos, files and
folders. Browse your drives visually, save references in collections, and build
search groups you can return to. Hover shortcuts keep everyday actions close:
save an item, rename it, preview it, or open its containing folder.

Combine file-kind tags such as `#img` and `#video` with folder tags such as
`##Pictures` or `##current` to say both **what** you want and **where** to look.
Colored tags show whether a place is found, matches several folders, or needs
to be added to Everything's index. Videos preview on hover and play inside tiles;
Restore returns to your last folder, search or search-group feed and scroll position.

Everywhere brings the dark walls, amber controls and hover shortcuts of
[Pinful](https://github.com/dmitryalexander/pinful) and
[Individuous](https://github.com/dmitryalexander/individuous) to your own files.

Everywhere is one small Windows program. It serves its page on
`http://127.0.0.1:3017` (this computer only) and opens it in a tab-less browser app
window. No Docker or account is required. Your collections and settings stay on
your PC. Optional artwork links open the artist's website in your browser.

**Status:** early Windows development preview. Build from source using the
instructions below; generated executables and personal settings are excluded
from this repository. Some browser tests still reflect the earlier ScratchPad
interface; see [the project diary](PROJECT_DIARY.md) for verification limits.

Not affiliated with voidtools.

## Requirements

- Windows 10 or 11
- **Everything** (standard edition, running). Everything Lite does not support the SDK connection.
- A Chromium browser: Brave, Google Chrome or Microsoft Edge. Edge comes with Windows,
  so nothing extra is needed. Everywhere uses the first it finds in that order (or the
  one where you installed Everywhere as an app; see below). Set `EVERYWHERE_BROWSER` to a
  browser's full path to choose it. With none of these, it opens in your default browser
  as an ordinary tab.
- Optional: FFmpeg (`winget install Gyan.FFmpeg`) for previews of AVI/WMV/FLV/MPG;
  IrfanView for opening images; PotPlayer for opening videos.

## Run

Double-click `Everywhere.exe`. Pin it to the taskbar if you like. The window opens
maximized. Opening it again while it runs just opens another window.

**Own taskbar icon:** an app window normally shows the browser's icon. Install Everywhere
once as an app: open `http://127.0.0.1:3017` in a normal tab of Brave, Chrome or Edge and
use the install button in the address bar. Everywhere.exe then opens the installed app,
which has the folder icon, and prefers that browser from then on. (Checked: Brave. Chrome
and Edge use the same app id scheme but have not been tried yet.)

Everywhere keeps running in the background after you close its window, like
Everything itself. To stop it: **Menu → Quit Everywhere**, or `Stop Everywhere.cmd`.

## Build

Needs Rust (rustup, MSVC toolchain). Run `Build Everywhere.cmd` (or `Build.ps1`).
It builds `Everywhere.exe` and the Explorer and Recycle Bin bridges with the C#
compiler included in Windows, then places them beside this README.

Resources: the icon and version details come from `assets/everywhere.rc`, prebuilt
into `assets/everywhere.res` (MSVC) and `assets/everywhere-res.o` (GNU) so no
resource compiler is needed. After editing the `.rc`, rebuild both with
`windres -O res` and `windres -O coff`.

## Your data

Collections, search groups, order and tile size are saved in
`data\settings.json` beside the program, with `settings.bak` kept on every save.
Back up that folder to keep them. To bring in collections from another copy (such as ScratchPad), set
`EVERYWHERE_IMPORT_SETTINGS` to that `settings.json` before the first run; the original
file is only read. Nothing is imported automatically. Video preview clips are cached in
`%LOCALAPPDATA%\Everywhere\video-previews` (at most 400 clips / 400 MB).

## Using it

**Menu (☰)** opens a page with your preferences and a full guide to every control.
Empty pages show a short first-steps guide with the same avatars as Pinful and Individuous.

- **Star**: saved collections. The name next to it chooses where **A** saves.
- **Folder icon**: This PC and its drives. **Magnifying glass**: the search-group feed.
- **Diamond**: Restore the last folder, search or search-group feed, including its scroll position.
- **Book**: files opened in this window. **Menu**: preferences, search tags, Quit.
- Click a search term to fill the box; **Enter** or **Ctrl+click** searches.
- Hover a tile: **A** save/remove in the current collection, **R** rename the real
  item, **Space** preview, **S** shuffle, **X X** remove. In saved collections X X
  removes only the saved reference; in file views it moves the real file or folder
  to the Recycle Bin (never a permanent delete). **Escape** cancels.
- Top red strip of a tile: browse its containing folder here. **Ctrl+click**: Explorer.
- Videos: rest the pointer for a silent preview; click to play with sound; **Z**
  fullscreen; **+ / −** volume.
- Search tags: `#img #video #docs #code #folder #archive #audio` and exact extensions
  like `#png #mp4`. Menu → Search tags lists every alias.
- Folders (two hashes say where): `##photos` searches inside every folder named photos
  (subfolders included) on all drives; `##photos #img` finds pictures there;
  `##photos ##pictures` searches both. Slashes pick one folder among same-named ones:
  `##projects/myapps` (`/` or `\`), a drive gives the exact place (`##c:/users/me`), and
  `##current` or `##.` is the open folder (`##current/raw` is inside it). Quote names with
  spaces (`##"My Photos"`); `##"current"` means a folder named current.
- The search box colors tags as you type: valid tags blue, a `##` tag green when it names
  exactly one folder and yellow-green when it names several. Red means an exact
  folder or drive exists but is not indexed; white means the tag is unknown or
  no matching folder was found.

## Security

The program answers only `127.0.0.1`/`localhost` on port 3017, refuses cross-site
browser requests to its file API, and requires a random per-run token for every
file action and video stream. File actions run only after a click or key press.

## Tests

`cargo test` runs the Rust unit tests. The browser checks in `tests/` use
Playwright (`PLAYWRIGHT_MODULE`, `EVERYWHERE_TEST_BROWSER`) against a running page.

## Credits and licensing

Everywhere uses the official Everything SDK and interface code developed for
Pinful. See [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and
`dependency-licenses/` for the included third-party licenses. A project-wide
license for Everywhere's original code has not yet been selected; third-party
components retain their own terms. Tutorial artwork links to [ynforma.art](https://ynforma.art).
