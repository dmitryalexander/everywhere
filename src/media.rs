//! Video playback for the Everywhere page (from ScratchPad, October 14, 2026).
//!
//! GET /media?t=TOKEN&path=PATH streams a local video file with HTTP ranges, so Brave
//! can play it, seek and preview it inside a tile. GET /preview?t=TOKEN&path=PATH
//! returns a short silent MP4 clip made with FFmpeg, for formats Brave cannot play
//! (AVI, WMV, FLV, MPG...). Clips are cached on disk and reused.
//!
//! Each media request runs on its own short-lived thread so the RPC workers stay
//! free, and every range answer is capped at CHUNK bytes: a paused or fully
//! buffered video never holds a connection (or a thread) for long.
use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Condvar, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

pub const CHUNK: u64 = 4 * 1024 * 1024;
const MAX_STREAMS: usize = 24;
const MAX_CONVERSIONS: usize = 2;
const CLIP_SECONDS: &str = "10";
const CACHE_FILES: usize = 400;
const CACHE_BYTES: u64 = 400 * 1024 * 1024;
static STREAMS: AtomicUsize = AtomicUsize::new(0);

/// Content type sent with a streamed video. Brave identifies the container itself;
/// the type only has to say "this is a video".
pub fn content_type(ext: &str) -> &'static str {
    match ext {
        "mp4" | "m4v" | "mov" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "avi" => "video/x-msvideo",
        "wmv" | "asf" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" | "mpe" | "mpv" | "vob" => "video/mpeg",
        "mts" | "m2ts" => "video/mp2t",
        "3gp" => "video/3gpp",
        "3g2" => "video/3gpp2",
        _ => "application/octet-stream",
    }
}

/// Query string of a request target, percent-decoded ("+" is a space, as URLSearchParams writes it).
pub fn query(target: &str) -> HashMap<String, String> {
    let q = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    q.split('&')
        .filter(|kv| !kv.is_empty())
        .filter_map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            Some((decode(k)?, decode(v)?))
        })
        .collect()
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' => {
                let hex = s.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Parses a Range header against a file of `len` bytes.
/// Ok(None): send the whole file. Ok(Some((start, end))): send that inclusive span,
/// capped at CHUNK bytes. Err(()): the range cannot be satisfied (416).
/// Malformed headers are ignored, as HTTP asks.
pub fn byte_range(header: Option<&str>, len: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else { return Ok(None) };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = first.split_once('-') else { return Ok(None) };
    let (a, b) = (a.trim(), b.trim());
    if len == 0 {
        return Err(());
    }
    let (start, end) = if a.is_empty() {
        let Ok(n) = b.parse::<u64>() else { return Ok(None) };
        if n == 0 {
            return Err(());
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let Ok(start) = a.parse::<u64>() else { return Ok(None) };
        let end = if b.is_empty() {
            len - 1
        } else {
            let Ok(end) = b.parse::<u64>() else { return Ok(None) };
            end.min(len - 1)
        };
        if start >= len || end < start {
            return Err(());
        }
        (start, end)
    };
    Ok(Some((start, end.min(start + CHUNK - 1))))
}

fn head(stream: &mut TcpStream, status: &str, lines: &[String], origin: &str) -> std::io::Result<()> {
    let mut text = format!("HTTP/1.1 {status}\r\n");
    for line in lines {
        text.push_str(line);
        text.push_str("\r\n");
    }
    text.push_str("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n");
    // Everywhere serves the page itself (same origin), so normally no CORS header is sent.
    if !origin.is_empty() { text.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n")); }
    text.push_str("\r\n");
    stream.write_all(text.as_bytes())
}

/// A short plain-text answer; the page only looks at the status code.
pub fn plain(stream: &mut TcpStream, status: &str, message: &str, origin: &str) {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let lines = [
        "Content-Type: text/plain; charset=utf-8".to_string(),
        format!("Content-Length: {}", message.len()),
    ];
    if head(stream, status, &lines, origin).is_ok() {
        let _ = stream.write_all(message.as_bytes());
        let _ = stream.flush();
    }
}

/// Streams `path` (or the requested part of it) to the browser.
pub fn serve_file(stream: &mut TcpStream, path: &Path, ctype: &str, range: Option<&str>, origin: &str) -> std::io::Result<()> {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let (status, start, count, mut lines) = match byte_range(range, len) {
        Err(()) => {
            let lines = [format!("Content-Range: bytes */{len}"), "Content-Length: 0".to_string()];
            return head(stream, "416 Range Not Satisfiable", &lines, origin);
        }
        Ok(None) => ("200 OK", 0, len, vec![]),
        Ok(Some((s, e))) => ("206 Partial Content", s, e - s + 1, vec![format!("Content-Range: bytes {s}-{e}/{len}")]),
    };
    lines.push(format!("Content-Type: {ctype}"));
    lines.push(format!("Content-Length: {count}"));
    lines.push("Accept-Ranges: bytes".to_string());
    head(stream, status, &lines, origin)?;
    file.seek(SeekFrom::Start(start))?;
    let mut part = file.take(count);
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let n = part.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n])?;
    }
    stream.flush()
}

struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        STREAMS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Answers a /media or /preview request on its own thread. The caller has already
/// checked the host, the page origin and the session token.
pub fn spawn(mut stream: TcpStream, convert: bool, args: HashMap<String, String>, range: Option<String>, origin: String) {
    if STREAMS.fetch_add(1, Ordering::SeqCst) >= MAX_STREAMS {
        STREAMS.fetch_sub(1, Ordering::SeqCst);
        plain(&mut stream, "503 Busy", "Too many videos are loading. Try again.", &origin);
        return;
    }
    std::thread::spawn(move || {
        let _slot = Slot;
        let path = match video_path(args.get("path").map(String::as_str)) {
            Ok(p) => p,
            Err((status, message)) => return plain(&mut stream, status, &message, &origin),
        };
        if convert {
            let made = preview_clip(&path, &|| connected(&stream));
            match made {
                Ok(clip) => {
                    let _ = serve_file(&mut stream, &clip, "video/mp4", range.as_deref(), &origin);
                }
                Err(Missing::Converter) => plain(&mut stream, "501 No Converter", "FFmpeg was not found.", &origin),
                Err(Missing::Gone) => {}
                Err(Missing::Failed(message)) => plain(&mut stream, "422 Unconvertible", &message, &origin),
            }
        } else {
            let ext = extension(&path);
            let _ = serve_file(&mut stream, &path, content_type(&ext), range.as_deref(), &origin);
        }
    });
}

fn extension(path: &Path) -> String {
    path.extension().unwrap_or_default().to_string_lossy().to_lowercase()
}

/// Only existing, absolute, local video files are served. Cloud files that are not
/// on this PC are refused, so a preview never downloads them.
fn video_path(raw: Option<&str>) -> Result<PathBuf, (&'static str, String)> {
    let raw = raw.filter(|p| !p.is_empty()).ok_or(("400 Bad Request", "Missing path".to_string()))?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(("400 Bad Request", "Choose an absolute Windows path.".into()));
    }
    if crate::categories::category(&extension(&path)) != "Videos" {
        return Err(("415 Not A Video", "Only video files play here.".into()));
    }
    let meta = fs::metadata(&path).map_err(|_| ("404 Not Found", "This file is no longer available.".to_string()))?;
    if !meta.is_file() {
        return Err(("404 Not Found", "This file is no longer available.".into()));
    }
    if offline(&meta) {
        return Err(("409 Offline", "This cloud file is not on this PC.".into()));
    }
    Ok(path)
}

#[cfg(windows)]
fn offline(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & (0x1000 | 0x400000) != 0
}
#[cfg(not(windows))]
fn offline(_: &fs::Metadata) -> bool {
    false
}

/// True while the browser still has the connection open.
fn connected(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return true;
    }
    let mut byte = [0u8; 1];
    let open = match stream.peek(&mut byte) {
        Ok(0) => false,
        Ok(_) => true,
        Err(e) => e.kind() == std::io::ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    open
}

fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

// ---------- FFmpeg and PotPlayer ----------

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn program_folders() -> Vec<PathBuf> {
    ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"].into_iter().filter_map(env_path).collect()
}

/// Finds ffmpeg.exe: next to the helper, on PATH, or where winget, Scoop,
/// Chocolatey and the usual manual installs put it.
pub fn ffmpeg() -> Option<PathBuf> {
    static FOUND: OnceLock<PathBuf> = OnceLock::new();
    if let Some(found) = FOUND.get() {
        return Some(found.clone());
    }
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    // Full builds from winget, Scoop, Chocolatey or a manual install come before PATH, where other
    // programs (Miniconda, for example) can put a reduced FFmpeg without the H.264 encoder.
    let mut candidates: Vec<PathBuf> = vec![];
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join(name));
        candidates.push(dir.join("ffmpeg").join("bin").join(name));
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
        candidates.push(local.join("Microsoft").join("WinGet").join("Links").join(name));
        // winget's Gyan.FFmpeg / BtbN.FFmpeg packages: Packages\<id>\<version folder>\bin\ffmpeg.exe
        let packages = local.join("Microsoft").join("WinGet").join("Packages");
        let mut found: Vec<PathBuf> = vec![];
        for package in fs::read_dir(packages).into_iter().flatten().flatten() {
            if !package.file_name().to_string_lossy().to_lowercase().contains("ffmpeg") {
                continue;
            }
            for inner in fs::read_dir(package.path()).into_iter().flatten().flatten() {
                found.push(inner.path().join("bin").join(name));
            }
        }
        found.sort();
        candidates.extend(found.into_iter().rev()); // newest version folder first
    }
    if let Some(home) = env_path("USERPROFILE") {
        candidates.push(home.join("scoop").join("shims").join(name));
        candidates.push(home.join("scoop").join("apps").join("ffmpeg").join("current").join("bin").join(name));
    }
    if let Some(data) = env_path("ProgramData") {
        candidates.push(data.join("chocolatey").join("bin").join(name));
    }
    for base in program_folders() {
        candidates.push(base.join("ffmpeg").join("bin").join(name));
        candidates.push(base.join("FFmpeg").join("bin").join(name));
    }
    candidates.push(PathBuf::from("C:\\ffmpeg\\bin").join(name));
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|p| p.join(name)));
    }
    let found = candidates.into_iter().find(|p| p.is_file())?;
    let _ = FOUND.set(found.clone());
    Some(found)
}

/// PotPlayer, used to open video files themselves.
pub fn video_player() -> Option<PathBuf> {
    let mut candidates = vec![];
    for base in program_folders() {
        for folder in ["DAUM\\PotPlayer", "PotPlayer", "Kakao\\PotPlayer"] {
            for exe in ["PotPlayerMini64.exe", "PotPlayerMini.exe", "PotPlayer64.exe", "PotPlayer.exe"] {
                candidates.push(base.join(folder).join(exe));
            }
        }
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
        for exe in ["PotPlayerMini64.exe", "PotPlayerMini.exe"] {
            candidates.push(local.join("Programs").join("PotPlayer").join(exe));
            candidates.push(local.join("Programs").join("DAUM").join("PotPlayer").join(exe));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

pub fn open_in_player(path: &Path) -> Option<Result<(), String>> {
    let player = video_player()?;
    Some(
        Command::new(player)
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open this video in PotPlayer: {e}")),
    )
}

// ---------- Preview clips ----------

pub enum Missing {
    Converter,
    Gone,
    Failed(String),
}

fn cache_dir() -> PathBuf {
    env_path("LOCALAPPDATA").unwrap_or_else(std::env::temp_dir).join("Everywhere").join("video-previews")
}

/// Waits for a child process. Returns None when it ran past `limit` or `keep_going`
/// said stop; the process is killed in both cases.
fn finish(mut child: Child, limit: Duration, keep_going: &dyn Fn() -> bool) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + limit;
    let mut checked = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            Err(_) => break,
        }
        if Instant::now() > deadline {
            break;
        }
        if checked.elapsed() > Duration::from_millis(400) {
            checked = Instant::now();
            if !keep_going() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

/// Reads a pipe on a side thread so a chatty process can never fill it and stall.
fn collect<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut pipe) = pipe {
            let mut bytes = vec![];
            let _ = pipe.read_to_end(&mut bytes);
            text = String::from_utf8_lossy(&bytes).into_owned();
        }
        text
    })
}

/// "Duration: 00:01:23.45" from FFmpeg's description of a file.
pub fn parse_duration(text: &str) -> Option<f64> {
    let rest = &text[text.find("Duration:")? + 9..];
    let stamp = rest.trim_start().split(|c: char| c == ',' || c.is_whitespace()).next()?;
    let mut seconds = 0.0;
    for part in stamp.split(':') {
        seconds = seconds * 60.0 + part.parse::<f64>().ok()?;
    }
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

fn duration(ffmpeg: &Path, path: &Path) -> Option<f64> {
    let probe = ffmpeg.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
    if probe.is_file() {
        let mut child = quiet(Command::new(&probe).args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"]).arg(path))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let out = collect(child.stdout.take());
        finish(child, Duration::from_secs(15), &|| true)?;
        let value: f64 = out.join().ok()?.trim().parse().ok()?;
        return (value.is_finite() && value > 0.0).then_some(value);
    }
    let mut child = quiet(Command::new(ffmpeg).args(["-hide_banner", "-nostdin", "-i"]).arg(path))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let err = collect(child.stderr.take());
    finish(child, Duration::from_secs(15), &|| true);
    parse_duration(&err.join().ok()?)
}

/// Where a silent preview starts: about 15% in, never more than a minute in.
pub fn preview_start(length: f64) -> f64 {
    if length >= 8.0 {
        (length * 0.15).min(60.0)
    } else {
        0.0
    }
}

struct Gate {
    busy: Mutex<(usize, HashSet<String>)>,
    changed: Condvar,
}
fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(|| Gate { busy: Mutex::new((0, HashSet::new())), changed: Condvar::new() })
}
struct Turn(String);
impl Drop for Turn {
    fn drop(&mut self) {
        let g = gate();
        if let Ok(mut busy) = g.busy.lock() {
            busy.0 -= 1;
            busy.1.remove(&self.0);
        }
        g.changed.notify_all();
    }
}

/// A short, silent, small MP4 of `path` that Brave can always play, made once and cached.
pub fn preview_clip(path: &Path, alive: &dyn Fn() -> bool) -> Result<PathBuf, Missing> {
    let ffmpeg = ffmpeg().ok_or(Missing::Converter)?;
    let meta = fs::metadata(path).map_err(|e| Missing::Failed(e.to_string()))?;
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().to_lowercase().hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified().ok().hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());
    let dir = cache_dir();
    let clip = dir.join(format!("{key}.mp4"));
    let ready = |p: &Path| fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false);
    if ready(&clip) {
        return Ok(clip);
    }
    // One conversion per file, two at a time. Waiting requests give up when the browser does.
    let g = gate();
    let _turn = {
        let mut busy = g.busy.lock().map_err(|_| Missing::Failed("Preview converter needs a restart.".into()))?;
        loop {
            if ready(&clip) {
                return Ok(clip);
            }
            if !alive() {
                return Err(Missing::Gone);
            }
            if busy.0 < MAX_CONVERSIONS && !busy.1.contains(&key) {
                busy.0 += 1;
                busy.1.insert(key.clone());
                break Turn(key.clone());
            }
            busy = g.changed.wait_timeout(busy, Duration::from_millis(300)).map_err(|_| Missing::Gone)?.0;
        }
    };
    if ready(&clip) {
        return Ok(clip);
    }
    fs::create_dir_all(&dir).map_err(|e| Missing::Failed(e.to_string()))?;
    let start = duration(&ffmpeg, path).map(preview_start).unwrap_or(0.0);
    let part = dir.join(format!("{key}.part"));
    let mut last = String::from("FFmpeg could not read this video.");
    // libx264 is in nearly every FFmpeg build; h264_mf (Windows Media Foundation) covers the rest.
    // Some files cannot seek, so a failed start part-way in is retried from the beginning.
    let mut attempts = vec![(start, "libx264"), (start, "h264_mf")];
    if start > 0.0 {
        attempts.extend([(0.0, "libx264"), (0.0, "h264_mf")]);
    }
    let mut missing: Vec<&str> = vec![];
    for (offset, encoder) in attempts {
        if missing.contains(&encoder) {
            continue;
        }
        if !alive() {
            return Err(Missing::Gone);
        }
        let _ = fs::remove_file(&part);
        let mut command = Command::new(&ffmpeg);
        command.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y"]);
        if offset > 0.0 {
            command.args(["-ss", &format!("{offset:.2}")]);
        }
        command.arg("-i").arg(path);
        command.args(["-t", CLIP_SECONDS, "-map", "0:v:0", "-an", "-sn", "-dn"]);
        command.args(["-vf", "scale=-2:'min(360,trunc(ih/2)*2)',setsar=1,format=yuv420p"]);
        if encoder == "libx264" {
            command.args(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30"]);
        } else {
            command.args(["-c:v", "h264_mf", "-b:v", "700k"]);
        }
        command.args(["-movflags", "+faststart", "-f", "mp4"]).arg(&part);
        let child = quiet(&mut command).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => return Err(Missing::Failed(format!("FFmpeg could not start: {e}"))),
        };
        let err = collect(child.stderr.take());
        let status = finish(child, Duration::from_secs(60), alive);
        let text = err.join().unwrap_or_default();
        match status {
            Some(s) if s.success() && ready(&part) => {
                fs::rename(&part, &clip).map_err(|e| Missing::Failed(e.to_string()))?;
                prune(&dir);
                return Ok(clip);
            }
            Some(_) => {
                if text.contains("Unknown encoder") || text.contains("Encoder not found") || text.contains("Error while opening encoder") {
                    missing.push(encoder);
                }
                last = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("FFmpeg could not convert this video.").chars().take(240).collect();
            }
            None => {
                let _ = fs::remove_file(&part);
                return Err(if alive() { Missing::Failed("Preview took too long.".into()) } else { Missing::Gone });
            }
        }
    }
    let _ = fs::remove_file(&part);
    Err(Missing::Failed(last))
}

/// Keeps the clip cache under CACHE_FILES files and CACHE_BYTES, oldest out first.
fn prune(dir: &Path) {
    let mut clips: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, m.len(), e.path()))
        })
        .collect();
    clips.sort_by_key(|c| c.0);
    let mut total: u64 = clips.iter().map(|c| c.1).sum();
    let mut count = clips.len();
    for (_, len, path) in clips {
        if count <= CACHE_FILES && total <= CACHE_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            count -= 1;
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_follow_http_and_are_capped() {
        assert_eq!(byte_range(None, 100), Ok(None));
        assert_eq!(byte_range(Some("bytes=0-"), 100), Ok(Some((0, 99))));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Ok(Some((10, 19))));
        assert_eq!(byte_range(Some("bytes=90-500"), 100), Ok(Some((90, 99))));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Ok(Some((90, 99))));
        assert_eq!(byte_range(Some("bytes=-1000"), 100), Ok(Some((0, 99))));
        assert_eq!(byte_range(Some("bytes=100-"), 100), Err(()));
        assert_eq!(byte_range(Some("bytes=50-40"), 100), Err(()));
        assert_eq!(byte_range(Some("bytes=-0"), 100), Err(()));
        assert_eq!(byte_range(Some("bytes=0-"), 0), Err(()));
        assert_eq!(byte_range(Some("bytes=abc"), 100), Ok(None));
        assert_eq!(byte_range(Some("items=0-5"), 100), Ok(None));
        assert_eq!(byte_range(Some("bytes=5-9, 20-30"), 100), Ok(Some((5, 9))));
        let big = 10 * CHUNK;
        assert_eq!(byte_range(Some("bytes=0-"), big), Ok(Some((0, CHUNK - 1))));
        assert_eq!(byte_range(Some("bytes=7-"), big), Ok(Some((7, 7 + CHUNK - 1))));
        assert_eq!(byte_range(Some("bytes=-5"), big), Ok(Some((big - 5, big - 1))));
    }
    #[test]
    fn query_strings_decode_windows_paths() {
        let q = query("/media?t=abc&path=C%3A%5CUsers%5CExample%5CVideos%5Cmy+clip%20%C3%A9.mp4");
        assert_eq!(q["t"], "abc");
        assert_eq!(q["path"], "C:\\Users\\Example\\Videos\\my clip é.mp4");
        assert!(query("/media?path=%ZZ").get("path").is_none());
        assert!(query("/media").is_empty());
    }
    #[test]
    fn durations_and_preview_starts() {
        assert_eq!(parse_duration("  Duration: 00:01:40.00, start: 0.0"), Some(100.0));
        assert_eq!(parse_duration("Duration: N/A, bitrate"), None);
        assert_eq!(preview_start(100.0), 15.0);
        assert_eq!(preview_start(3600.0), 60.0);
        assert_eq!(preview_start(5.0), 0.0);
    }
    #[test]
    fn content_types() {
        assert_eq!(content_type("mp4"), "video/mp4");
        assert_eq!(content_type("mov"), "video/mp4");
        assert_eq!(content_type("webm"), "video/webm");
    }
}
