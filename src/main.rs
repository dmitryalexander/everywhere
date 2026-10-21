#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod everything;
mod categories;
mod thumbnails;
mod server;
mod media;

use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::Mutex};
use std::os::windows::{fs::MetadataExt, process::CommandExt};


#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    path: String, name: String, kind: String, is_dir: bool, size: u64, modified: u64,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page { entries: Vec<Entry>, total: u64, has_more: bool }
struct Store { settings: PathBuf, web: PathBuf, save_lock: Mutex<()>, sdk: Mutex<everything::Sdk> }

use categories::category;
fn entry(path: &Path) -> Option<Entry> {
    let m = fs::metadata(path).ok()?;
    let name = path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into_owned();
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    Some(Entry { path: path.to_string_lossy().into_owned(), name,
        kind: if m.is_dir() { "Folders" } else { category(&ext) }.into(),
        is_dir: m.is_dir(), size: m.len(),
        modified: m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|v| v.as_secs()).unwrap_or(0),
    })
}
fn checked_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() { return Err("Choose an absolute Windows path.".into()); }
    if !p.exists() { return Err("This file or folder is no longer available.".into()); }
    Ok(p)
}
fn folder_page(path: &str, filter: &str, sort: &str, offset: usize, limit: usize) -> Result<Page, String> {
    let path = checked_path(path)?;
    let mut entries: Vec<_> = fs::read_dir(path).map_err(|e| format!("Cannot read this folder: {e}"))?
        .filter_map(Result::ok).filter_map(|e| entry(&e.path())).filter(|e| filter == "All" || e.kind == filter).collect();
    entries.sort_by(|a,b| b.is_dir.cmp(&a.is_dir).then_with(|| match sort {
        "Newest" => b.modified.cmp(&a.modified).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        "Largest" => b.size.cmp(&a.size).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    }));
    let total = entries.len();
    let end = offset.saturating_add(limit).min(total);
    let page = if offset < total { entries.drain(offset..end).collect() } else { vec![] };
    Ok(Page { entries: page, total: total as u64, has_more: end < total })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Startup { locations: Vec<Entry>, drives: Vec<Drive>, everything_running: bool, version: String, preview_converter: bool, video_player: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Drive {
    #[serde(flatten)]
    entry: Entry,
    total_bytes: Option<u64>,
    free_bytes: Option<u64>,
}
#[link(name = "kernel32")]
extern "system" {
    fn GetLogicalDrives() -> u32;
    fn MoveFileW(from: *const u16, to: *const u16) -> i32;
    fn GetDiskFreeSpaceExW(path: *const u16, available: *mut u64, total: *mut u64, free: *mut u64) -> i32;
}
fn startup(state: &Store) -> Startup {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let mut locations: Vec<Entry> = ["Downloads", "Documents", "Pictures", "Videos", "Music", "Desktop"]
        .iter().filter_map(|n| entry(&PathBuf::from(&home).join(n))).collect();
    // Include redirected Windows known folders when the standard path is absent.
    for (id, name) in [(0x0005, "Documents"), (0x0027, "Pictures"), (0x0000, "Desktop")] {
        let mut path = [0u16; 260];
        if unsafe { SHGetFolderPathW(std::ptr::null_mut(), id, std::ptr::null_mut(), 0, path.as_mut_ptr()) } >= 0 {
            let end = path.iter().position(|v| *v == 0).unwrap_or(path.len());
            let p = PathBuf::from(String::from_utf16_lossy(&path[..end]));
            if !locations.iter().any(|e| Path::new(&e.path) == p) {
                if let Some(mut e) = entry(&p) { e.name = name.into(); locations.push(e); }
            }
        }
    }
    let mask = unsafe { GetLogicalDrives() };
    let drives = (0..26).filter(|i| mask & (1 << i) != 0).filter_map(|i| {
        let letter = (b'A' + i as u8) as char;
        let path = format!("{letter}:\\");
        entry(Path::new(&path)).map(|mut e| {
            e.name = format!("Drive ({letter}:)"); e.kind = "Drives".into();
            let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
            let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) } != 0;
            Drive { entry: e, total_bytes: ok.then_some(total), free_bytes: ok.then_some(free) }
        })
    }).collect();
    let running = state.sdk.lock().map(|s| s.running()).unwrap_or(false);
    Startup { locations, drives, everything_running: running, version: server::VERSION.into(),
        preview_converter: media::ffmpeg().is_some(), video_player: media::video_player().map(|p| p.to_string_lossy().into_owned()) }
}
fn text_preview(path: String) -> Result<String, String> {
    let p = checked_path(&path)?;
    let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    if !matches!(ext.as_str(), "txt"|"md"|"csv"|"rs"|"py"|"js"|"ts"|"tsx"|"html"|"css"|"json"|"yaml"|"yml"|"toml"|"c"|"cpp"|"h"|"cs"|"go"|"ps1"|"sql"|"xml"|"log") { return Ok(String::new()); }
    let m = fs::metadata(&p).map_err(|e| e.to_string())?;
    if m.file_attributes() & (0x1000 | 0x400000) != 0 { return Ok(String::new()); }
    let mut bytes = Vec::new();
    fs::File::open(&p).map_err(|e| e.to_string())?.take(16000).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.contains(&0) { return Ok(String::new()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(window: *mut std::ffi::c_void, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    fn SHGetFolderPathW(window: *mut std::ffi::c_void, id: i32, token: *mut std::ffi::c_void, flags: u32, path: *mut u16) -> i32;
}
fn open_file(path: String) -> Result<(), String> {
    let path = checked_path(&path)?;
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    if path.is_file() && category(&ext) == "Images" {
        let viewer = irfan_view().ok_or("IrfanView was not found. Install it to open images from Everywhere.")?;
        std::process::Command::new(viewer).arg(&path).spawn()
            .map_err(|e| format!("Could not open this image in IrfanView: {e}"))?;
        return Ok(());
    }
    // Videos open in PotPlayer when it is installed (October 14, 2026); otherwise in the Windows default app.
    if path.is_file() && category(&ext) == "Videos" {
        if let Some(result) = media::open_in_player(&path) { return result; }
    }
    let file: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    let op: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    if result <= 32 { Err(format!("Windows could not open this file (code {result}).")) } else { Ok(()) }
}
fn irfan_view() -> Option<PathBuf> {
    ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .into_iter().filter_map(|key| std::env::var_os(key))
        .flat_map(|base| ["i_view64.exe", "i_view32.exe"].map(|exe| PathBuf::from(&base).join("IrfanView").join(exe)))
        .find(|path| path.is_file())
}
fn reveal_file(path: String) -> Result<(), String> {
    open_in_explorer(path)
}
fn open_in_explorer(path: String) -> Result<(), String> {
    let checked = checked_path(&path)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bridge = exe.parent().ok_or("Cannot locate Explorer bridge")?.join("explorer-bridge.exe");
    let result = std::process::Command::new(bridge).arg(checked).creation_flags(0x08000000)
        .output().map_err(|e| format!("Could not open Explorer: {e}"))?;
    if result.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&result.stderr).trim().to_string()) }
}
fn recycle_file(path: String) -> Result<(), String> {
    let checked = checked_path(&path)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bridge = exe.parent().ok_or("Cannot locate Recycle Bin bridge")?.join("recycle-bridge.exe");
    let result = std::process::Command::new(bridge).arg(checked).creation_flags(0x08000000)
        .output().map_err(|e| format!("Could not move this item to the Recycle Bin: {e}"))?;
    if result.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&result.stderr).trim().to_string()) }
}
fn valid_filename(name: &str) -> bool {
    if name.is_empty() || name.encode_utf16().count() > 255 || name.ends_with([' ', '.'])
        || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) { return false; }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str()) { return false; }
    let numbered = stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT"));
    !numbered.is_some_and(|suffix| ["1","2","3","4","5","6","7","8","9","¹","²","³"].contains(&suffix))
}
fn rename_item(path: &str, name: &str) -> Result<Entry, String> {
    if !valid_filename(name) { return Err("Choose a valid Windows name without reserved names, slashes, or a trailing dot or space.".into()); }
    let source = checked_path(path)?;
    let parent = source.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("Drive roots cannot be renamed here.")?;
    let target = parent.join(name);
    if source == target { return entry(&source).ok_or("This item is no longer available.".into()); }
    let from: Vec<u16> = source.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    // MoveFileW refuses to overwrite an existing target, including a race.
    if unsafe { MoveFileW(from.as_ptr(), to.as_ptr()) } == 0 {
        return Err(format!("Could not rename this item: {}", std::io::Error::last_os_error()));
    }
    entry(&target).ok_or("The item was renamed, but its details could not be read. Reload this folder.".into())
}
fn start_everything() -> Result<(), String> {
    let candidates = [std::env::var("ProgramW6432"), std::env::var("ProgramFiles"), std::env::var("ProgramFiles(x86)")];
    for base in candidates.into_iter().flatten() {
        let path = PathBuf::from(base).join("Everything").join("Everything.exe");
        if path.is_file() {
            std::process::Command::new(path).arg("-startup").creation_flags(0x08000000).spawn().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("Everything was not found in Program Files. Start the standard Everything app manually, then retry. The Lite edition does not support this connection.".into())
}
fn load_settings(state: &Store) -> serde_json::Value {
    fs::read(&state.settings).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(serde_json::json!({}))
}
fn save_settings(value: serde_json::Value, state: &Store) -> Result<(), String> {
    let _guard = state.save_lock.lock().map_err(|_| "Settings need a restart")?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 { return Err("Too many saved items.".into()); }
    let temp = state.settings.with_extension("tmp");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    if state.settings.exists() {
        fs::copy(&state.settings, state.settings.with_extension("bak")).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, &state.settings).map_err(|e| e.to_string())
}
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--self-test") {
        let result = self_test();
        let report = std::env::var("FILE_WALL_TEST_REPORT").unwrap_or_else(|_| "self-test.json".into());
        let _ = fs::write(report, serde_json::to_vec_pretty(&result).unwrap());
        std::process::exit(if result["passed"].as_bool().unwrap_or(false) { 0 } else { 1 });
    }
    // Stops a running Everywhere (used by Build.ps1 before replacing the program).
    if args.iter().any(|a| a == "--quit") { std::process::exit(if server::quit_running() { 0 } else { 1 }); }
    let window = !args.iter().any(|a| a == "--no-window");
    let Some(root) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) else {
        fail("Everywhere could not find its own folder.");
    };
    match server::bind() {
        Ok(listener) => {
            let ready = move || if window { if let Err(e) = open_window() { show_error(&e); } };
            // The window is maximized on a helper thread while the server keeps answering.
            if let Err(error) = server::run(listener, &root, ready) { fail(&error); }
        }
        // Already running: just open another window onto it.
        Err(_) if server::running_instance() => {
            if window {
                match open_window() { Ok(maximizing) => { let _ = maximizing.join(); } Err(e) => fail(&e) }
            }
        }
        Err(_) => fail(&format!("Everywhere could not start: port {} is used by another program.", server::PORT)),
    }
}
fn fail(message: &str) -> ! {
    let _ = fs::write(std::env::temp_dir().join("Everywhere-error.txt"), message);
    show_error(message);
    std::process::exit(1);
}
#[link(name = "user32")]
extern "system" { fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, caption: *const u16, kind: u32) -> i32; }
fn show_error(message: &str) {
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let caption: Vec<u16> = "Everywhere".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10); }
}
/// Chromium's id for the installed Everywhere web app: SHA-256 of the manifest id URL,
/// first 16 bytes as hex with 0-f mapped to a-p (crx_file::id_util::GenerateId).
fn web_app_id() -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{}/", server::ORIGIN).as_bytes());
    digest[..16].iter().flat_map(|b| [b >> 4, b & 15]).map(|n| (b'a' + n) as char).collect()
}
/// Chromium browsers Everywhere can open as a tab-less app window, in order of preference:
/// program location under Program Files / AppData, and the user-data folder under AppData.
const BROWSERS: [(&str, &str, &str); 3] = [
    ("brave.exe", r"BraveSoftware\Brave-Browser\Application\brave.exe", r"BraveSoftware\Brave-Browser\User Data"),
    ("chrome.exe", r"Google\Chrome\Application\chrome.exe", r"Google\Chrome\User Data"),
    ("msedge.exe", r"Microsoft\Edge\Application\msedge.exe", r"Microsoft\Edge\User Data"),
];
fn env_dir(key: &str) -> Option<PathBuf> { std::env::var_os(key).map(PathBuf::from) }
/// Where a browser from BROWSERS is installed, if it is.
fn find_browser(program: &str) -> Option<PathBuf> {
    ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].into_iter()
        .filter_map(env_dir).map(|base| base.join(program)).find(|p| p.is_file())
}
/// Whether Everywhere is installed as a web app in this browser's Default profile. The app
/// then gets Everywhere's own taskbar icon instead of the browser's.
fn app_installed(user_data: &str) -> bool {
    env_dir("LOCALAPPDATA").is_some_and(|local| local.join(user_data)
        .join(r"Default\Web Applications\Manifest Resources").join(web_app_id()).is_dir())
}
/// Opens Everywhere in a tab-less app window. Order: EVERYWHERE_BROWSER if set; a browser
/// (Brave, Chrome, Edge) where Everywhere is installed as an app; the first of those that is
/// installed; finally the default browser in an ordinary tab.
fn open_window() -> Result<std::thread::JoinHandle<()>, String> {
    let before = everywhere_windows();
    launch_window()?;
    Ok(std::thread::spawn(move || maximize_new_window(&before)))
}
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(callback: unsafe extern "system" fn(isize, isize) -> i32, data: isize) -> i32;
    fn GetWindowTextW(window: isize, text: *mut u16, max: i32) -> i32;
    fn GetClassNameW(window: isize, name: *mut u16, max: i32) -> i32;
    fn IsWindowVisible(window: isize) -> i32;
    fn ShowWindow(window: isize, command: i32) -> i32;
}
unsafe extern "system" fn collect_window(window: isize, data: isize) -> i32 {
    (*(data as *mut Vec<isize>)).push(window); 1
}
fn window_string(window: isize, read: unsafe extern "system" fn(isize, *mut u16, i32) -> i32) -> String {
    let mut text = [0u16; 512];
    let len = unsafe { read(window, text.as_mut_ptr(), text.len() as i32) }.max(0) as usize;
    String::from_utf16_lossy(&text[..len.min(text.len())])
}
/// Visible Chromium windows whose title names Everywhere (the page titles all end with it).
fn everywhere_windows() -> Vec<isize> {
    let mut all: Vec<isize> = Vec::new();
    unsafe { EnumWindows(collect_window, &mut all as *mut Vec<isize> as isize); }
    all.into_iter().filter(|&w| unsafe { IsWindowVisible(w) } != 0
        && window_string(w, GetClassNameW) == "Chrome_WidgetWin_1"
        && window_string(w, GetWindowTextW).contains("Everywhere")).collect()
}
/// Waits up to 10 seconds for the new Everywhere window, then maximizes it. A running
/// browser ignores --start-maximized for windows it opens on another program's behalf.
fn maximize_new_window(before: &[isize]) {
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if let Some(window) = everywhere_windows().into_iter().find(|w| !before.contains(w)) {
            unsafe { ShowWindow(window, 3); } // SW_MAXIMIZE
            return;
        }
    }
}
/// Starts the browser window; see `open_window`.
fn launch_window() -> Result<(), String> {
    let custom = env_dir("EVERYWHERE_BROWSER").filter(|p| p.is_file());
    let mut found: Vec<(PathBuf, bool)> = Vec::new();
    if let Some(path) = custom {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
        let installed = BROWSERS.iter().find(|b| b.0 == name).is_some_and(|b| app_installed(b.2));
        found.push((path, installed));
    } else {
        for (_, program, user_data) in BROWSERS {
            if let Some(path) = find_browser(program) { found.push((path, app_installed(user_data))); }
        }
        // Prefer the browser where Everywhere was installed as an app.
        found.sort_by_key(|(_, installed)| !installed);
    }
    if let Some((browser, installed)) = found.into_iter().next() {
        let mut command = std::process::Command::new(&browser);
        command.arg("--start-maximized");
        if installed { command.args(["--profile-directory=Default".to_string(), format!("--app-id={}", web_app_id())]); }
        else { command.arg(format!("--app={}", server::START_PAGE)); }
        return command.spawn()
            .map(|_| ()).map_err(|e| format!("Could not open the Everywhere window: {e}"));
    }
    let url: Vec<u16> = server::START_PAGE.encode_utf16().chain(Some(0)).collect();
    let op: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), url.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
    if result <= 32 { Err(format!("No browser was found. Open {} manually.", server::START_PAGE)) } else { Ok(()) }
}
fn self_test() -> serde_json::Value {
    let result = (|| -> Result<serde_json::Value, String> {
        let dir = std::env::var("FILE_WALL_TEST_FOLDER").map_err(|_| "Missing test folder")?;
        let page = folder_page(&dir, "All", "Name", 0, 100)?;
        if page.total < 3 { return Err("Fixture files missing".into()); }
        let folders = folder_page(&dir, "Folders", "Name", 0, 100)?;
        if folders.entries.iter().any(|e| !e.is_dir) { return Err("Folder filter failed".into()); }
        let offset = folder_page(&dir, "All", "Name", 1, 1)?;
        if offset.entries.len() != 1 || offset.entries[0].path != page.entries[1].path { return Err("Pagination failed".into()); }
        if checked_path("relative.txt").is_ok() { return Err("Relative path accepted".into()); }
        let image_path = PathBuf::from(&dir).join("sample.png");
        let image = thumbnails::get(&image_path.to_string_lossy())?.ok_or("Image thumbnail failed")?;
        if !image.data.starts_with("data:image/png;base64,") { return Err("Invalid preview".into()); }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut sdk = everything::Sdk::load(&exe.parent().unwrap().join("Everything64.dll")).map_err(|e| e.to_string())?;
        let running = sdk.running();
        let search = sdk.query("file-wall", None, "All", "Name", 0);
        if running && search.is_err() { return Err(format!("Everything query failed: {:?}", search)); }
        if !running && search.is_ok() { return Err("Unavailable Everything did not return an error".into()); }
        if running {
            let scoped = sdk.query("", Some(&dir), "All", "Name", 0)?;
            if scoped.total != page.total { return Err(format!("Folder scope mismatch: {} vs {}", scoped.total, page.total)); }
            let filtered = sdk.query("", Some(&dir), "Images", "Name", 0)?;
            if filtered.entries.len() != 1 || filtered.entries[0].name != "sample.png" { return Err("Everything image filter failed".into()); }
            let second = sdk.query("", Some(&dir), "All", "Name", 2)?;
            if second.entries.len() != scoped.entries.len().saturating_sub(2) { return Err("Everything pagination failed".into()); }
        }
        Ok(serde_json::json!({"folder_entries":page.total,"pagination":true,"filter":true,"thumbnail":{"width":image.width,"height":image.height},"everything_running":running,"search_results":search.ok().map(|p|p.total)}))
    })();
    match result { Ok(details) => serde_json::json!({"passed":true,"details":details}), Err(e) => serde_json::json!({"passed":false,"error":e}) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn categories_cover_mixed_files() {
        assert_eq!(category("png"), "Images"); assert_eq!(category("pdf"), "Documents");
        assert_eq!(category("rs"), "Code"); assert_eq!(category("exe"), "Programs");
        assert_eq!(category("ts"), "Code"); assert_eq!(category("markdown"), "Documents");
        assert_eq!(category("docx"), "Documents"); assert_eq!(category("swift"), "Code");
    }
    #[test] fn web_app_id_matches_chromium_format() { assert_eq!(web_app_id(), "kphnolgojoallinnmjckigfopdhbklfc"); }
    #[test] fn relative_paths_are_rejected() { assert!(checked_path("..\\file.txt").is_err()); }
    #[test] fn rename_names_cannot_escape_or_use_reserved_windows_names() {
        for name in ["", "..", "../other", "C:\\file", "file/child", "file.", "file ", "CON.txt", "lpt1", "COM¹.txt", "a:b", "a?b"] { assert!(!valid_filename(name), "{name}"); }
        for name in ["Photo 2.jpg", "new folder", "COM10.txt", "résumé.md"] { assert!(valid_filename(name)); }
    }
    #[test] fn rename_preserves_contents_and_never_overwrites() {
        let dir=std::env::temp_dir().join(format!("everywhere-rename-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();let source=dir.join("before.txt");let taken=dir.join("taken.txt");
        fs::write(&source,"original").unwrap();fs::write(&taken,"keep").unwrap();
        assert!(rename_item(source.to_str().unwrap(),"taken.txt").is_err());
        assert_eq!(fs::read_to_string(&taken).unwrap(),"keep");
        let renamed=rename_item(source.to_str().unwrap(),"after.txt").unwrap();
        assert_eq!(fs::read_to_string(&renamed.path).unwrap(),"original");assert!(!source.exists());
        fs::remove_file(&renamed.path).unwrap();fs::remove_file(taken).unwrap();fs::remove_dir(dir).unwrap();
    }
}
