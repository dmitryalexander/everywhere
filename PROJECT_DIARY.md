# Everywhere project diary

Working memory for Everywhere: what it is, how it is built, the decisions that must survive
between sessions, what has been verified, and what is next. Add a dated entry at the end of
the log after each piece of work, and update **Current state** and **Next steps**.

This file is part of the project folder and may be published with it. Keep personal
information out: no Windows user names, personal folder paths, file names from your own
drives, account names or screenshots of personal content.

## Current state (October 21, 2026, evening)

- Windows build of `Everywhere.exe` 0.1.0 plus the Explorer and Recycle Bin bridges, rebuilt
  with everything below; it contains no user name or personal paths.
- Runs without Docker. Opens maximized in Brave, Chrome or Edge; as an installed web app it
  has its own folder icon on the taskbar (confirmed in Brave).
- Search: `#` tags for kinds of files, `##` for places (folder names, slash chains, drives,
  `##current`), with live colors in the search box (blue, green, yellow-green, red, white).
- Empty-page avatar guides and a full Menu tutorial that matches the current app.
- Restore (diamond) returns to the last folder, search or search-group feed and its scroll position.
- Removed: followed folders and their feed, `#current`.
- Starts empty for a new user; personal data from development has been cleared.
- Repository: `https://github.com/dmitryalexander/everywhere`. Source publication
  authorized October 21; a project-wide license has not yet been selected.

## What Everywhere is

A visual wall for voidtools Everything: search every drive instantly and browse files and
folders as thumbnails, with saved collections, search groups, folder-aware search tags, inline
video previews and the same hover shortcuts as Pinful and Individuous. It replaces ScratchPad,
which stays installed and unchanged until Everywhere fully takes over.

Name: the family names come from what each app builds on (Pinless → Pinful, Invidious →
Individuous, Brave → Bravely). Everywhere builds on Everything. The interface (toolbar,
search-term bar, pickers) is the owner's own code from Pinful, not upstream Pinless, which
has no JavaScript.

## Architecture

- **One program.** `Everywhere.exe` (Rust) serves the page from `web/` and the file API on
  `127.0.0.1:3017`, same origin. No Docker, no nginx, no second helper process.
- **Window.** Opens a tab-less app window (`--app=`) in Brave, Chrome or Edge, in that order;
  a browser where Everywhere is installed as a web app wins, and is opened with
  `--app-id=kphnolgojoallinnmjckigfopdhbklfc` so the window has Everywhere's taskbar icon.
  The id is Chromium's: SHA-256 of `http://127.0.0.1:3017/` (the manifest id), first 16
  bytes, hex digits mapped to a–p. The app is detected by
  `<user data>\Default\Web Applications\Manifest Resources\<id>`. `EVERYWHERE_BROWSER`
  overrides; with no Chromium browser, the default browser opens an ordinary tab.
- **Single instance.** A second launch only opens another window. Everywhere keeps running
  after its window closes; Menu → Quit Everywhere (click twice), `Stop Everywhere.cmd` or
  `Everywhere.exe --quit` stops it.
- **Security.** Answers only Host `127.0.0.1:3017`/`localhost:3017` (blocks DNS rebinding).
  The API (`/session`, `/rpc`, `/media`, `/preview`) refuses cross-site `Sec-Fetch-Site` and
  foreign `Origin`, and needs a random per-run token. No CORS headers. Static files are
  confined to `web/`. `localhost` page requests redirect to `127.0.0.1` so browser storage
  stays in one origin.
- **Search.** Through the official `Everything64.dll`; the standard Everything app must be
  running (Lite is not supported). Browsing folders and collections works without it.
- **Data.** `data/settings.json` beside the program, with `settings.bak` on each save. The
  page keeps no browser storage of its own except per-window session history. Storage keys
  keep their `scratchpad-*` names for compatibility. Import is opt-in only, through
  `EVERYWHERE_IMPORT_SETTINGS`. Video preview clips are cached in
  `%LOCALAPPDATA%\Everywhere\video-previews`.
- **Resources.** Icon and version details are prebuilt from `assets/everywhere.rc` into
  `everywhere.res` (MSVC) and `everywhere-res.o` (GNU) and linked by `build.rs`, so no
  resource compiler is needed.

## Files

| Path | Purpose |
| --- | --- |
| `src/main.rs` | Startup, single instance, browser choice, maximizing, file actions |
| `src/server.rs` | Page and API server, security checks, settings import |
| `src/everything.rs` | Everything SDK queries, `#`/`##` parsing (`FolderTag`), folder counts |
| `src/categories.rs` | File kinds and extension tags |
| `src/media.rs`, `thumbnails.rs` | Video streaming/previews, Windows thumbnails |
| `bridges/*.cs` | Explorer focus and Recycle Bin helpers (built with the Windows C# compiler) |
| `web/app.js` and friends | The wall, pickers, videos, This PC, History |
| `web/search-colors.js` | Live tag colors in the search box |
| `web/search-tags.js` | Menu → Search tags dialog |
| `web/empty-guide.js`, `tutorial.css`, `web/tutorial/` | Avatar guides on empty pages |
| `web/menu.js` | Menu page: preferences and the tutorial |
| `web/quit.js` | Menu → Quit Everywhere |
| `web/manifest.json`, `web/icons/` | Web-app install (own taskbar icon) |
| `Build.ps1`, `Build Everywhere.cmd` | Build; the log goes to `build-log.txt` |
| `tests/` | Playwright browser checks (need `PLAYWRIGHT_MODULE`, `EVERYWHERE_TEST_BROWSER`) |

## Build and run

1. Close every Everywhere window. An open window holds its data in memory.
2. Run `Build Everywhere.cmd`. It needs Rust (MSVC toolchain). It quits a running copy,
   builds, and places `Everywhere.exe` and the bridges in this folder.
3. Double-click `Everywhere.exe`.

Page files in `web/` are read from disk: changes there need only a page reload, not a
rebuild. Changes in `src/` or `Cargo.toml` need a rebuild.

The build replaces the user folder with `~` and this folder with `everywhere` in paths the
compiler embeds (`CARGO_ENCODED_RUSTFLAGS` with `--remap-path-prefix`), so the program
carries no personal folder names.

## Decisions to keep

- No Docker. One program on one port.
- A Chromium app window (Brave first, then Chrome, then Edge; an installed app wins),
  opened maximized.
- One `#` says what kind of file; two `##` say where to look.
- `##` syntax: `/` or `\` chain folders; dots are part of names; a drive needs its colon
  (`##c:/users`); `##current` or `##.` is the open folder; quotes allow spaces and make
  `##"current"` a real folder name. `#current` is gone (plain text now).
- Search-box colors: blue known tag; green one folder; yellow-green several; red exists but
  not indexed by Everything; white unknown.
- X X wording must always distinguish: in a collection it removes only the saved reference;
  in folders, searches, the search-group feed and History it moves the real item to the
  Recycle Bin.
- No followed folders in Everywhere (`##` covers it). Restore keeps one last place.
- No automatic import from ScratchPad.
- No personal paths or names in code, tests, binaries or this diary.
- Default new collection is named "Saved"; Favorites is filled with the standard Windows
  folders.
- Uploads from the cloud workspace use a new staging name each time and are confirmed by
  checksum (a reused name once delivered a stale file).

## Verification record

- Cloud (Playwright, stand-in server with Everywhere's Content-Security-Policy): every page
  loads with no console errors; Quit sends stop; empty-page guides appear for Collections,
  History, Search groups, Search and "Everything not running"; the Menu page renders every
  section; Search tags dialog, collection controls and the search action work; no horizontal
  overflow at 390 px; tag colors (including red and `##current`) appear correctly, aligned
  within 0.1 px, on both search-box backgrounds. Web-app manifest: no installability errors.
- Rust, compiled in the cloud outside the Windows-only crate: 13 search tests pass
  (`everything.rs`, `categories.rs`); the browser-choice and window-maximizing code compiles.
- Windows: the latest build succeeds and contains the `##`, browser and maximize code, with
  no user name, `MyApps` or `Users\` path. The owner confirmed the folder icon with the
  installed Brave app.
- Not yet live-checked on Windows: `##` searches and colors with real folders, red for an
  unindexed thumb drive, opening maximized, Chrome/Edge app installs; the full browser workflow;
  the six browser tests copied from ScratchPad (they fail identically on the unmodified
  ScratchPad page in the cloud: they need the real program, proprietary video codecs, and
  one is out of date); a full manual pass.

## Next steps

- Live check of the latest build: `#img ##Pictures`, `##current` with a folder open,
  `##d:` with a thumb drive before and after adding it in Everything, opening maximized.
- Confirm the initial GitHub publication, then select a project-wide license.
  Review whether any styling or markup from
  Pinless's original templates is included; if none, `Pinless-LICENSE.txt` can go.
- Run `cargo test` and the browser tests on Windows; update the copied tests to the new
  single-origin setup where they still assume the old helper.
- Manual pass: search, tags, folders, collections, rename, Recycle Bin (with disposable
  files), videos, Quit and relaunch.
- Optional: show On/Off on "Show filenames" (ScratchPad never did); shrink the tutorial
  images (about 6.5 MB); remove the leftover followed-folder styles in the minified
  `web/app.css`.

## Log

### 2026-10-21 — Project started

Everywhere was started from scratch as the Docker-free successor to ScratchPad, with the
same interface. New clean project folder; ScratchPad left untouched. The page server and the
file helper were merged into one Rust program on port 3017. Interface branding changed to
Everywhere, and the Menu gained Quit Everywhere. Third-party notices corrected: the toolbar
comes from Pinful, not Pinless.

### 2026-10-21 — First Windows build

The first build stopped at cargo's first progress line: Windows PowerShell 5 treats a
program's stderr as an error. `Build.ps1` now runs cargo through `cmd` with stderr merged.
The build then succeeded.

### 2026-10-21 — Avatars and Menu tutorial

Added the avatar guides on empty pages (artwork shared with Pinful and Individuous) and
turned the ☰ drop-down into a Menu page with preferences and boxed guides: the top bar, tile
zones and keys, videos, collections and search terms, search tags, places, and data and
privacy. Every instruction was checked against the code.

### 2026-10-21 — Own taskbar icon

The Brave app window showed Brave's icon, because `--app` windows belong to Brave. Added a
web-app manifest with folder icons, and `Everywhere.exe` now opens the installed app by its
computed id. The owner confirmed the folder icon after installing.

### 2026-10-21 — Personal data cleared

Development data was cleared (settings reset; automatic ScratchPad import removed). The
build cache and build log, which held personal paths, were deleted. A personal folder was
removed from the default locations and a user name from a test. The owner's shortcut moved
out of the project and `*.lnk` is ignored. The build now remaps embedded paths; the rebuilt
program was scanned and is clean.

### 2026-10-21 — Diary started

This diary was created. Everywhere entries go here from now on; the MyApps family diary only
points to it.

### 2026-10-21 — ## folder search

New search syntax requested by the owner: `##name` searches inside every folder with that
exact name, on all indexed drives, subfolders included (owner's choice over direct contents
only). It becomes the Everything constraint `path:"\name\"`, which matches any path running
through a folder of that name, but not the folder itself. Combines with tags and words
(`##photos #img holiday`), and with `#current`. Quoted names allow spaces
(`##"My Photos"`); several `##` names in one search are alternatives; repeated names are
merged ignoring case. Inside quotes or mid-word (`a##b`) it stays literal text. Empty names,
unclosed quotes, and characters that cannot appear in a folder name (`\ / : * ? < > | "`)
give a clear message. Documented in the Search tags dialog, the Menu guide, the empty-search
guide and the README. Needs a rebuild; the live check on Windows is still to do.

### 2026-10-21 — ## folder chains; restore button removed

Owner's idea: dots in a `##` tag name the folders above, to tell apart same-named folders.
`##projects.myapps` becomes `path:"\projects\myapps\"` (myapps directly inside projects, at
any depth). A single-letter first part may be a drive: `##c.users` matches either a folder
named c or `C:\Users` (`<path:"\c\users\"> | <path:"c:\users\">`). Because dots now chain,
a folder name with dots must be quoted (`##".git"`); inside quotes a backslash chains folders
and an explicit drive works (`##"D:\Work"`). Empty parts (`##a..b`, `##.git`, `##a.`) explain
the dot and quote rules. 11 search tests pass in the cloud (two for `##`). The restore
(diamond) button was removed from the top bar and the Menu guide; it only repeated This PC.
Search tags dialog, Menu guide and README updated. Needs a rebuild and a live check.

### 2026-10-21 — Tag colors in the search box

As you type, valid `#` tags (types, extensions, `#current`) turn blue; a `##` folder tag turns
green when it names exactly one folder and yellow-green for two or more. Darker shades are
used on the amber active-search background. An input can't color parts of its text, so
`web/search-colors.js` lays a copy of the text over the box (`aria-hidden`, no pointer
events) and makes the box's own text transparent only while something is colored; caret,
selection and typing stay the real input's. Measured alignment: under 0.1 px, scrolling
included. It also notices values the page sets itself (opening a search link).
Folder counts come from a new RPC, `folder_tag_count` (0, 1, or 2 = two or more), debounced
250 ms and cached per tag. In Rust, `FolderTag` now holds the parsing for both searching and
counting: it asks Everything for folders with that exact last name (`folder: wfn:"name"`,
narrowed by the chain's path), then keeps only full paths that end with the chain, or equal
the drive path. 12 search tests pass in the cloud. Needs a rebuild and a live check with
real folders.

### 2026-10-21 — First live try; slashes; ##current

Live try of `#imgs ##Pictures` found nothing and `##Pictures` stayed white. Cause, checked:
the running Everywhere.exe was built before `##` existed (no `##` code or `folder_tag_count`
in the binary), so the old program searched for the literal text. The blue `#imgs` worked
because page files load from disk. A rebuild is needed.

Owner decisions: chain folders with slashes instead of dots, and move `#current` to
`##current` (removing `#current` entirely, since it was confusing). Now `/` and `\` both
chain (Windows itself accepts both), dots are ordinary name characters (`##.git`), a
drive needs its colon (`##c:/users`; `##c/users` is just a folder named c), `##current` and
`##.` mean the open folder, and `##current/raw` is inside it. `##"current"` (quoted) is a
folder really named current. `..` is refused. Tags with an exact place (drive or open
folder) are counted by checking that the folder exists; name chains still ask Everything
and keep only exact path endings. The search box sends the open folder with the count
request, and remembers `##current` answers per folder. Search tags dialog no longer lists a
"Folder scope" group. 12 search tests pass in the cloud.

### 2026-10-21 — Build failure fixed; red for unindexed folders

The build failed (`folder_tag_count` takes 1 argument but 2 were supplied): `src/everything.rs`
on disk was an older version than the tested one. Cause: uploads from the cloud workspace
that reuse the same staging file name can deliver a previous copy. Fix: each upload now uses
a new staging name, and every file is confirmed by checksum after it lands.
`everything.rs` and `categories.rs` now match the tested versions (13 search tests pass).

New: a `##` tag that names an exact folder or drive (`##d:`, `##c:/users/me`, `##current`)
turns red when the folder exists but Everything has not indexed it, such as a FAT/exFAT
thumb drive not added under Everything's Options. Hovering the search box then explains how
to add it. `folder_tag_count` returns -1 for that case: a drive root counts as indexed if
Everything lists anything on it; a folder counts if Everything lists the folder itself.
Needs the rebuild.

### 2026-10-21 — Browsers other than Brave

Without Brave, Everywhere already fell back to Edge (built into Windows) and then the
default browser, but the own-icon app only worked in Brave and Chrome was skipped. Now
Brave, Chrome and Edge are all candidates, in that order, and whichever has Everywhere
installed as a web app (Default profile) is preferred and opened by app id.
`EVERYWHERE_BROWSER` still overrides, and gets the app id when it is one of the three.
The logic compiles and was checked on a mock folder layout in the cloud; Chrome and Edge
app installs have not been tried for real. README and Menu no longer say Brave is
required. Needs the rebuild.

### 2026-10-21 — Opens maximized

Owner asked for the window to open maximized. `--start-maximized` is passed, but a browser
that is already running ignores window-size options for windows another program asks it to
open (it forwards the command line to the running instance). So `Everywhere.exe` notes the
visible Chromium windows titled "…Everywhere" before launching, then for up to 10 seconds
looks for a new one and maximizes it (`ShowWindow(SW_MAXIMIZE)`). This runs on a helper
thread so the server keeps answering; a second launch waits for it before exiting. The code
compiles (checked in the cloud without linking); live behavior still to be confirmed after
the rebuild.

### 2026-10-21 — Followed folders removed; Menu guide refreshed

Owner decided followed folders don't fit Everywhere (searching with `##` covers the need).
Removed the person button, its panel, `web/following.js`, the followed-folder feed
(`?pt_page=feed` now opens the star page), its two empty-page guides and the avatar only they
used, and its styles. A saved `scratchpad-followed-folders-v1` value in old settings is
simply ignored. README and notices updated.

The Menu guide was rewritten to match the app as it is now: welcome (opens maximized; Brave,
Chrome or Edge; install for the taskbar icon), top bar without the person and diamond
buttons, a new "Searching and tags" section (# for what kind, ## for where with slash chains,
drives and ##current, the five search-box colors including red, and how to make Everything
index a thumb drive), tiles and keys (X X wording now says "the search-group feed"),
videos, collections and search groups, "This PC and History", and data (no followed
folders). Page files only: reload to see it, no rebuild needed for this part.

### 2026-10-21 — Diary brought up to date

Checked the owner's latest build: it succeeded and includes the `##` search, folder counts
with red for unindexed places, the Brave/Chrome/Edge choice and window maximizing, with no
personal paths in the program. Current state, Files, Decisions, Verification and Next steps
were rewritten to match.


### 2026-10-21 - Guide artwork links to ynforma.art

The character artwork on empty-page guides is now a link to https://ynforma.art (new tab).
web/empty-guide.js makes the art an anchor; web/tutorial.css drops pointer-events:none and
shows a pointer cursor. No rebuild needed.

### 2026-10-21 - Menu switches like Pinful's

The Menu page's button box is replaced by a row of round switches matching Pinful's Menu:
Loop video, Hover previews, Filenames, Order and Quit Everywhere. Removed from the Menu
page: Choose folder, Fullscreen (F11 still works), Reconnect Everything (the empty
"Connecting to Everything" guide still offers Start Everything), Search tags (opened from
the Searching and tags guide) and Edit search terms. Each switch presses the original hidden
button, so behavior and saving are unchanged; labels and on/off states mirror it. Filenames
now shows on/off, and Order shows the saved order on load (it used to always say newest).
Checked with a stand-in server in Chromium: all switches toggle, no console errors, no
horizontal overflow at 390px.

### 2026-10-21 - Restore button

New diamond button (#restore-link, /?pt_page=restore) just right of the folder button, like
Restore in Pinful/Individuous. It keeps one place: the last folder, search or search-group
feed and its scroll position, in browser store key everywhere-restore-v1 (saved to
data/settings.json, so it survives quitting). Saved when a view loads, after scrolling stops
(400 ms) and before in-app navigation. Clicking it reopens that address with ew_restore=1,
loads more pages until the old scroll position fits, scrolls there and removes the flag.
With nothing saved it shows an empty-page guide with the looking-around character
(web/tutorial/restore.png, copied from Individuous tutorial-restore-meme.png). Menu's top
bar guide lists the Diamond. Stand-in server check in Chromium: guide shows when empty;
folder scrolled to 4000px -> This PC -> Restore returned to the folder at 4000px; no errors.

### 2026-10-21 - GitHub source publication

The owner requested publication of Everywhere, Pinful and Individuous. Initialized
this repository on main and prepared the first source commit for the existing public
repository https://github.com/dmitryalexander/everywhere. Expanded README with a
product description, search and Restore behavior, build instructions, preview status,
and existing licensing limits; set the GitHub About description to match.
Updated current notes to retain the restored diamond button.

Verified all web JavaScript syntax and all 24 Windows Rust unit tests. The first
Rust run hit a permission error in the system temporary directory; rerunning with
TEMP and TMP inside ignored test-results passed all tests. Staged-file inspection
confirmed personal settings, generated executables, build output, logs and shortcuts
are excluded. Existing third-party license files are retained unchanged. Live browser
checks listed above remain pending; no runtime rebuild or settings changes were made.