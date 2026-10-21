use crate::{Entry, Page, category};
use libloading::Library;
use std::path::Path;

pub struct Sdk { lib: Library }
impl Sdk {
    pub fn load(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self { lib: unsafe { Library::new(path)? } })
    }
    pub fn running(&self) -> bool {
        unsafe { self.lib.get::<unsafe extern "system" fn() -> u32>(b"Everything_GetMajorVersion\0").map(|f| f() > 0).unwrap_or(false) }
    }
    pub fn query(&mut self, query: &str, folder: Option<&str>, filter: &str, sort: &str, offset: u32) -> Result<Page, String> {
        self.query_scoped(query, folder, filter, sort, offset, None)
    }
    pub fn query_scoped(&mut self, query: &str, folder: Option<&str>, filter: &str, sort: &str, offset: u32, current_folder: Option<&str>) -> Result<Page, String> {
        let query = compose_scoped(query, folder, filter, current_folder)?;
        unsafe {
            macro_rules! call { ($name:literal, $ty:ty $(, $arg:expr)*) => { (self.lib.get::<$ty>(concat!($name,"\0").as_bytes()).map_err(|e| e.to_string())?)($($arg),*) }; }
            call!("Everything_Reset", unsafe extern "system" fn());
            let wide: Vec<_> = query.encode_utf16().chain(Some(0)).collect();
            call!("Everything_SetSearchW", unsafe extern "system" fn(*const u16), wide.as_ptr());
            call!("Everything_SetMax", unsafe extern "system" fn(u32), 100);
            call!("Everything_SetOffset", unsafe extern "system" fn(u32), offset);
            call!("Everything_SetRequestFlags", unsafe extern "system" fn(u32), 1|2|16|64);
            call!("Everything_SetSort", unsafe extern "system" fn(u32), match sort { "Newest" => 14, "Largest" => 6, _ => 1 });
            let ok = call!("Everything_QueryW", unsafe extern "system" fn(i32) -> i32, 1);
            if ok == 0 {
                let error = call!("Everything_GetLastError", unsafe extern "system" fn() -> u32);
                return Err(if error == 2 { "Everything is not running. Use Start Everything, or start the standard app manually. The Lite edition does not support search integration.".into() } else { format!("Everything could not complete this search (code {error}). Try again when its index is ready.") });
            }
            let count = call!("Everything_GetNumResults", unsafe extern "system" fn() -> u32);
            let total = call!("Everything_GetTotResults", unsafe extern "system" fn() -> u32);
            let mut entries = Vec::with_capacity(count as usize);
            for i in 0..count {
                let mut wide = vec![0u16; 32768];
                let len = call!("Everything_GetResultFullPathNameW", unsafe extern "system" fn(u32,*mut u16,u32) -> u32, i, wide.as_mut_ptr(), wide.len() as u32);
                let path = String::from_utf16_lossy(&wide[..(len as usize).min(wide.len()-1)]);
                let p = Path::new(&path);
                let is_dir = call!("Everything_IsFolderResult", unsafe extern "system" fn(u32) -> i32, i) != 0;
                let mut size = 0i64; let mut time = 0i64;
                call!("Everything_GetResultSize", unsafe extern "system" fn(u32,*mut i64) -> i32, i, &mut size);
                call!("Everything_GetResultDateModified", unsafe extern "system" fn(u32,*mut i64) -> i32, i, &mut time);
                let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
                entries.push(Entry { name: p.file_name().unwrap_or(p.as_os_str()).to_string_lossy().into_owned(),
                    kind: if is_dir { "Folders" } else { category(&ext) }.into(), is_dir, size: size.max(0) as u64,
                    modified: ((time / 10_000_000) - 11_644_473_600).max(0) as u64, path });
            }
            Ok(Page { entries, total: total as u64, has_more: offset.saturating_add(count) < total })
        }
    }
}
impl Sdk {
    /// Full paths of up to `max` results for `query` (used to check `##` folder tags).
    pub fn paths(&mut self, query: &str, max: u32) -> Result<Vec<String>, String> {
        unsafe {
            macro_rules! call { ($name:literal, $ty:ty $(, $arg:expr)*) => { (self.lib.get::<$ty>(concat!($name,"\0").as_bytes()).map_err(|e| e.to_string())?)($($arg),*) }; }
            call!("Everything_Reset", unsafe extern "system" fn());
            let wide: Vec<_> = query.encode_utf16().chain(Some(0)).collect();
            call!("Everything_SetSearchW", unsafe extern "system" fn(*const u16), wide.as_ptr());
            call!("Everything_SetMax", unsafe extern "system" fn(u32), max);
            call!("Everything_SetRequestFlags", unsafe extern "system" fn(u32), 1|2);
            if call!("Everything_QueryW", unsafe extern "system" fn(i32) -> i32, 1) == 0 { return Err("Everything is not running.".into()); }
            let count = call!("Everything_GetNumResults", unsafe extern "system" fn() -> u32);
            let mut paths = Vec::with_capacity(count as usize);
            for i in 0..count {
                let mut wide = vec![0u16; 32768];
                let len = call!("Everything_GetResultFullPathNameW", unsafe extern "system" fn(u32,*mut u16,u32) -> u32, i, wide.as_mut_ptr(), wide.len() as u32);
                paths.push(String::from_utf16_lossy(&wide[..(len as usize).min(wide.len()-1)]));
            }
            Ok(paths)
        }
    }
    /// How many folders a `##` tag names: 0, 1 or 2 (meaning two or more), or -1 when the
    /// exact folder or drive exists but Everything has not indexed it (for example a FAT
    /// thumb drive that was never added in Everything's options).
    pub fn folder_tag_count(&mut self, raw: &str, current: Option<&str>) -> Result<i32, String> {
        let tag = FolderTag::parse(raw, current)?;
        if let Some(exact) = tag.exact() {
            if !std::path::Path::new(&exact).is_dir() { return Ok(0); }
            let indexed = match exact_folder_query(&exact) {
                // A drive root is not a result itself: look for anything on it.
                None => !self.paths(&format!("path:\"{exact}\""), 1)?.is_empty(),
                Some(query) => self.paths(&query, 50)?.iter().any(|p| p.trim_end_matches('\\').eq_ignore_ascii_case(exact.trim_end_matches('\\'))),
            };
            return Ok(if indexed { 1 } else { -1 });
        }
        let Some(query) = tag.folder_query() else { return Ok(0) };
        Ok(self.paths(&query, 200)?.iter().filter(|p| tag.matches(p)).take(2).count() as i32)
    }
}
/// Everything query that finds one exact folder (`C:\\Shoots\\raw\\` → its own entry), or None for
/// a drive root, which Everything does not list as a result.
fn exact_folder_query(exact: &str) -> Option<String> {
    let path = exact.trim_end_matches('\\');
    let (_, name) = path.rsplit_once('\\')?;
    Some(format!("folder: wfn:\"{name}\" path:\"{path}\""))
}
fn folder_constraint(folder: &str) -> String {
    format!("path:\"{}\\\"", folder.trim_end_matches('\\').replace('"', ""))
}
// Type tags are alternatives within each expression branch. Keep explicit OR
// branches and nested groups independent so their words retain their meaning.
fn expand_hashtags(query: &str, current_folder: Option<&str>) -> Result<String, String> {
    let chars: Vec<char> = query.chars().collect();
    let mut i = 0;
    expand_group(&chars, &mut i, None, current_folder)
}
fn expand_group(chars: &[char], i: &mut usize, closing: Option<char>, current_folder: Option<&str>) -> Result<String, String> {
    let mut branches = Vec::new();
    let mut output = String::new();
    let mut kinds = Vec::new();
    let mut folders: Vec<String> = Vec::new();
    let mut quoted = false;
    while *i < chars.len() {
        let c = chars[*i];
        if !quoted && (Some(c) == closing || c == '|') {
            branches.push(finish_branch(&output, &kinds, &folders));
            output.clear(); kinds.clear(); folders.clear();
            *i += 1;
            if Some(c) == closing { return Ok(branches.join(" | ")); }
            continue;
        }
        if !quoted && (c == '<' || c == '(') {
            *i += 1;
            let end = if c == '<' { '>' } else { ')' };
            output.push(c);
            output.push_str(&expand_group(chars, i, Some(end), current_folder)?);
            output.push(end);
            continue;
        }
        if c == '"' { quoted = !quoted; }
        let at_start = *i == 0 || chars[*i-1].is_whitespace() || "<(|".contains(chars[*i-1]);
        // ##name: everything inside every folder with that exact name, at any depth.
        if c == '#' && !quoted && at_start && chars.get(*i+1) == Some(&'#') {
            if let Some((constraint, end)) = folder_tag(chars, *i+2, current_folder)? {
                if !folders.iter().any(|f| f.eq_ignore_ascii_case(&constraint)) { folders.push(constraint); }
                *i = end;
                continue;
            }
        }
        if c == '#' && !quoted && at_start {
            let mut end = *i+1;
            while end < chars.len() && chars[end].is_ascii_alphanumeric() { end += 1; }
            if end == chars.len() || chars[end].is_whitespace() || ">)|".contains(chars[end]) {
                let tag: String = chars[*i+1..end].iter().collect();
                if let Some(constraint) = crate::categories::tag_constraint(&tag) {
                    if !kinds.contains(&constraint) { kinds.push(constraint); }
                    *i = end;
                    continue;
                }
            }
        }
        output.push(c);
        *i += 1;
    }
    branches.push(finish_branch(&output, &kinds, &folders));
    Ok(branches.join(" | "))
}
/// A `##` folder tag: where to look. Slashes (`/` or `\`) chain folders, so `##projects/myapps`
/// is a folder named myapps directly inside one named projects, anywhere. `##c:/users` starts
/// at a drive. `##current` (or `##.`) is the folder you have open, and `##current/photos` a
/// folder inside it. Quotes allow spaces, and `##"current"` means a folder named current.
pub struct FolderTag { base: Base, parts: Vec<String> }
enum Base { Anywhere, Exact(String) }
impl FolderTag {
    /// `raw` is the text after `##`, quotes included when quoted.
    pub fn parse(raw: &str, current: Option<&str>) -> Result<Self, String> {
        let quoted = raw.starts_with('"');
        let inner = if quoted {
            raw[1..].strip_suffix('"').ok_or("Close the quotes after ##, as in ##\"My Photos\".")?
        } else { raw };
        let mut parts: Vec<String> = inner.split(['/', '\\']).map(|p| p.trim().to_string()).collect();
        while parts.len() > 1 && parts.last().is_some_and(String::is_empty) { parts.pop(); }
        if parts.iter().all(String::is_empty) { return Err("Add a folder name after ##, such as ##photos.".into()); }
        if parts[0].is_empty() { return Err("Start with a folder name, a drive such as ##c:/users, or ##current.".into()); }
        if parts.iter().any(String::is_empty) { return Err("Put one slash between folder names, as in ##projects/myapps.".into()); }
        let first = parts[0].clone();
        let drive = first.len() == 2 && first.ends_with(':') && first.starts_with(|c: char| c.is_ascii_alphabetic());
        let here = first == "." || (!quoted && first.eq_ignore_ascii_case("current"));
        let base = if drive {
            parts.remove(0); Base::Exact(format!("{first}\\"))
        } else if here {
            parts.remove(0);
            let open = current.map(|p| p.trim()).filter(|p| !p.is_empty()).ok_or("Open a folder first to use ##current.")?;
            Base::Exact(format!("{}\\", open.trim_end_matches('\\')))
        } else { Base::Anywhere };
        for part in &parts {
            if part == "." || part == ".." { return Err("Name each folder; “.” and “..” only work as ##. for the open folder.".into()); }
            if part.chars().any(|c| ":*?<>|\"".contains(c) || c.is_control()) {
                return Err(format!("“{part}” can’t be a folder name. Use names such as ##photos or ##projects/myapps."));
            }
        }
        Ok(Self { base, parts })
    }
    /// The one folder an exact tag names (drive or open folder), with a trailing backslash.
    fn exact(&self) -> Option<String> {
        match &self.base {
            Base::Exact(start) => Some(if self.parts.is_empty() { start.clone() } else { format!("{start}{}\\", self.parts.join("\\")) }),
            Base::Anywhere => None,
        }
    }
    /// Everything constraint for files inside the folder(s), at any depth.
    pub fn constraint(&self) -> String {
        format!("path:\"{}\"", self.exact().unwrap_or_else(|| format!("\\{}\\", self.parts.join("\\"))))
    }
    /// Everything query for same-named folders (a superset; see `matches`). None for exact tags.
    fn folder_query(&self) -> Option<String> {
        if self.exact().is_some() { return None; }
        let last = self.parts.last()?;
        Some(if self.parts.len() == 1 { format!("folder: wfn:\"{last}\"") }
            else { format!("folder: wfn:\"{last}\" path:\"\\{}\"", self.parts.join("\\")) })
    }
    /// Whether a folder's full path ends with this tag's chain of names.
    fn matches(&self, path: &str) -> bool {
        path.trim_end_matches('\\').to_lowercase().ends_with(&format!("\\{}", self.parts.join("\\")).to_lowercase())
    }
}
/// Reads the `##` tag starting at `start` (after the hashes). Returns None when the text is
/// not a folder tag, so it stays search text.
fn folder_tag(chars: &[char], start: usize, current: Option<&str>) -> Result<Option<(String, usize)>, String> {
    let boundary = |end: usize| end == chars.len() || chars[end].is_whitespace() || ">)|".contains(chars[end]);
    let end = if chars.get(start) == Some(&'"') {
        start + 2 + chars[start+1..].iter().position(|c| *c == '"').ok_or("Close the quotes after ##, as in ##\"My Photos\".")?
    } else {
        let mut end = start;
        while end < chars.len() && !chars[end].is_whitespace() && !">)|\"".contains(chars[end]) { end += 1; }
        end
    };
    if !boundary(end) { return Ok(None); }
    let raw: String = chars[start..end].iter().collect();
    Ok(Some((FolderTag::parse(&raw, current)?.constraint(), end)))
}
fn finish_branch(text: &str, kinds: &[String], folders: &[String]) -> String {
    let mut parts = Vec::new();
    if !text.trim().is_empty() { parts.push(text.trim().to_string()); }
    if !kinds.is_empty() {
        parts.push(format!("<{}>", kinds.iter().map(|constraint| format!("<{constraint}>")).collect::<Vec<_>>().join(" | ")));
    }
    match folders.len() {
        0 => {}
        1 => parts.push(folders[0].clone()),
        _ => parts.push(format!("<{}>", folders.iter().map(|f| format!("<{f}>")).collect::<Vec<_>>().join(" | "))),
    }
    parts.join(" ")
}
#[cfg(test)]
fn compose(query: &str, folder: Option<&str>, filter: &str) -> String {
    compose_scoped(query, folder, filter, None).unwrap()
}
fn compose_scoped(query: &str, folder: Option<&str>, filter: &str, current_folder: Option<&str>) -> Result<String, String> {
    let mut parts = Vec::new();
    if let Some(folder) = folder { parts.push(folder_constraint(folder)); }
    let constraint = crate::categories::constraint(filter);
    if !constraint.is_empty() { parts.push(constraint.into()); }
    if !query.trim().is_empty() { parts.push(format!("<{}>", expand_hashtags(query, current_folder)?)); }
    Ok(parts.join(" "))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn user_or_expression_is_grouped() {
        assert_eq!(compose("cat | dog", None, "Images"), format!("{} <cat | dog>", crate::categories::constraint("Images")));
    }
    #[test] fn folder_scope_is_quoted() {
        assert!(compose("*.pdf", Some("C:\\My Files"), "All").starts_with("path:\"C:\\My Files\\\" "));
    }
    #[test] fn hashtags_search_types_without_a_folder_scope() {
        for (tag, kind) in [("#image", "Images"), ("#images", "Images"), ("#VIDEO", "Videos"), ("#VIDEOS", "Videos"), ("#document", "Documents"), ("#documents", "Documents"), ("#code", "Code"), ("#audio", "Audio"), ("#archive", "Archives"), ("#archives", "Archives")] {
            let q = compose(tag, None, "All");
            assert!(q.contains("file: ext:"));
            assert!(q.contains(crate::categories::extensions(kind).unwrap()));
            assert!(!q.contains("path:") && !q.contains('#'));
        }
    }
    #[test] fn folder_hashtags_filter_the_remaining_search_terms() {
        assert_eq!(compose("recycle bin #folder", None, "All"), "<recycle bin <<folder:>>>");
        assert_eq!(compose("#FOLDERS recycle bin", None, "All"), "<recycle bin <<folder:>>>");
        assert_eq!(compose("<#folder recycle> | <#image holiday>", None, "All"),
            format!("<<recycle <<folder:>>> | <holiday <<{}>>>>", crate::categories::constraint("Images")));
        for literal in ["\"#folder\"", "#folder2", "#folder.png", "my#folder", "#unknown"] {
            assert_eq!(expand_hashtags(literal, None).unwrap(), literal);
        }
    }
    #[test] fn hashtags_preserve_terms_quotes_and_or_groups() {
        assert!(compose("#images holiday", None, "All").starts_with("<holiday "));
        let q = compose("<#images> | <#videos>", None, "All");
        assert!(q.contains(" | ") && !q.contains('#'));
        for literal in ["\"#images\"", "#images2", "#images.png", "my#images", "#unknown"] {
            assert_eq!(expand_hashtags(literal, None).unwrap(), literal);
        }
    }
    #[test] fn combined_types_are_alternatives_and_aliases_are_deduplicated() {
        let types = format!("<<{}> | <{}>>", crate::categories::constraint("Images"), crate::categories::constraint("Videos"));
        assert_eq!(compose("#img #video holiday", None, "All"), format!("<holiday {types}>"));
        assert_eq!(compose("#image #img #images #video", None, "All"), format!("<{types}>"));
    }
    #[test] fn current_is_a_folder_tag_and_the_old_single_hash_is_plain_text() {
        assert!(compose_scoped("#img #video ##current", None, "All", None).is_err());
        let q = compose_scoped("#img #video ##CURRENT", None, "All", Some("C:\\My Files")).unwrap();
        assert!(q.contains(" | ") && q.contains("path:\"C:\\My Files\\\"") && !q.contains('#'));
        assert_eq!(compose_scoped("##.", None, "All", Some("C:\\My Files\\")).unwrap(), "<path:\"C:\\My Files\\\">");
        assert_eq!(compose_scoped("##./raw ##current\\2024", None, "All", Some("C:\\Shoots")).unwrap(),
            "<<<path:\"C:\\Shoots\\raw\\\"> | <path:\"C:\\Shoots\\2024\\\">>>");
        assert_eq!(compose_scoped("#current", None, "All", Some("C:\\Photos")).unwrap(), "<#current>");
        assert_eq!(compose_scoped("\"##current\"", None, "All", None).unwrap(), "<\"##current\">");
        assert_eq!(compose("##\"current\"", None, "All"), "<path:\"\\current\\\">");
    }
    #[test] fn extension_tags_are_exact_case_insensitive_and_combinable() {
        assert_eq!(compose_scoped("holiday #PNG #jpg #mp4 #7z ##current", None, "All", Some("C:\\Photos")).unwrap(),
            "<holiday <<file: ext:png> | <file: ext:jpg> | <file: ext:mp4> | <file: ext:7z>> path:\"C:\\Photos\\\">");
        for ext in crate::categories::extension_tags().into_iter().filter(|ext| *ext != "img") {
            assert_eq!(compose(&format!("#{}", ext.to_ascii_uppercase()), None, "All"), format!("<<<file: ext:{ext}>>>"));
        }
        assert_eq!(compose("#doc #docs", None, "All"), format!("<<<file: ext:doc> | <{}>>>", crate::categories::constraint("Documents")));
        for literal in ["#png2", "#mp4.png", "\"#PNG\"", "#madeupextension", "name#jpg"] {
            assert_eq!(expand_hashtags(literal, None).unwrap(), literal);
        }
    }
    #[test] fn double_hash_names_folders_at_any_depth() {
        assert_eq!(compose("##photos", None, "All"), "<path:\"\\photos\\\">");
        assert_eq!(compose("holiday ##Photos #img", None, "All"),
            format!("<holiday <<{}>> path:\"\\Photos\\\">", crate::categories::constraint("Images")));
        assert_eq!(compose("##\"My Photos\" #mp4", None, "All"), "<<<file: ext:mp4>> path:\"\\My Photos\\\">");
        assert_eq!(compose("##photos ##Pictures ##PHOTOS", None, "All"), "<<<path:\"\\photos\\\"> | <path:\"\\Pictures\\\">>>");
        assert_eq!(compose("<##a x> | <##b y>", None, "All"), "<<x path:\"\\a\\\"> | <y path:\"\\b\\\">>");
        assert_eq!(compose("##.git ##v1.2", None, "All"), "<<<path:\"\\.git\\\"> | <path:\"\\v1.2\\\">>>");
        for literal in ["\"##photos\"", "a##photos", "##photos\"x"] {
            assert_eq!(expand_hashtags(literal, None).unwrap(), literal);
        }
        for bad in ["##", "## photos", "##*", "##\"open", "##a:b"] { assert!(expand_hashtags(bad, None).is_err(), "{bad}"); }
    }
    #[test] fn slashes_chain_folders_and_drives_need_a_colon() {
        for q in ["##projects/myapps", "##projects\\myapps", "##projects/myapps/"] {
            assert_eq!(compose(q, None, "All"), "<path:\"\\projects\\myapps\\\">", "{q}");
        }
        assert_eq!(compose("##c:/users/example #img", None, "All"), format!("<<<{}>> path:\"c:\\users\\example\\\">", crate::categories::constraint("Images")));
        assert_eq!(compose("##\"C:\\Program Files\"", None, "All"), "<path:\"C:\\Program Files\\\">");
        assert_eq!(compose("##d:", None, "All"), "<path:\"d:\\\">");
        assert_eq!(compose("##c/users", None, "All"), "<path:\"\\c\\users\\\">");
        assert_eq!(compose("##\"My Photos/2024\"", None, "All"), "<path:\"\\My Photos\\2024\\\">");
        for bad in ["##a//b", "##/photos", "##a/../b", "##a/./b", "##x:/y:"] { assert!(expand_hashtags(bad, None).is_err(), "{bad}"); }
    }
    #[test] fn folder_tags_check_their_own_folders() {
        let t = FolderTag::parse("projects/myapps", None).unwrap();
        assert_eq!(t.folder_query().unwrap(), "folder: wfn:\"myapps\" path:\"\\projects\\myapps\"");
        assert!(t.matches("C:\\Users\\Example\\Projects\\MyApps") && t.matches("D:\\projects\\myapps\\"));
        assert!(!t.matches("D:\\projectsX\\myapps") && !t.matches("D:\\projects\\myapps\\sub") && !t.matches("D:\\old-projects\\myapps"));
        assert_eq!(FolderTag::parse("photos", None).unwrap().folder_query().unwrap(), "folder: wfn:\"photos\"");
        assert_eq!(FolderTag::parse("c:/users", None).unwrap().exact().unwrap(), "c:\\users\\");
        assert_eq!(FolderTag::parse("current/raw", Some("C:\\Shoots")).unwrap().exact().unwrap(), "C:\\Shoots\\raw\\");
        assert!(FolderTag::parse("current", None).is_err() && FolderTag::parse("\"open", None).is_err());
    }
    #[test] fn exact_folders_are_checked_by_their_own_entry() {
        assert_eq!(exact_folder_query("C:\\Shoots\\raw\\").unwrap(), "folder: wfn:\"raw\" path:\"C:\\Shoots\\raw\"");
        assert!(exact_folder_query("d:\\").is_none() && exact_folder_query("D:").is_none());
    }
    #[test] fn every_alias_is_case_insensitive_and_advertised() {
        for (kind, aliases) in crate::categories::ALIASES {
            for alias in aliases.split(';') {
                let q = compose(&format!("#{}", alias.to_ascii_uppercase()), None, "All");
                assert_eq!(q, format!("<<<{}>>>", crate::categories::constraint(kind)));
            }
        }
        let options = crate::categories::tag_options();
        assert!(options["extensions"].as_array().unwrap().iter().any(|ext| ext == "7z"));
        assert!(options.get("scope").is_none());
    }
}
