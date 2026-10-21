//! Everywhere's local web server: one loopback port serves the page (web/) and the
//! file API, so no Docker or second process is needed (October 21, 2026).
//!
//! Protections: only Host 127.0.0.1/localhost:PORT is answered (blocks DNS rebinding);
//! API routes refuse cross-site browser requests (Sec-Fetch-Site) and foreign Origins;
//! /rpc and media need the per-run random session token. No CORS headers are sent.
use crate::*;
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Read, Write}, net::{TcpListener, TcpStream}, sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc}, time::Duration};
pub const PORT: u16 = 3017;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const ORIGIN: &str = "http://127.0.0.1:3017";
pub const START_PAGE: &str = "http://127.0.0.1:3017/?pt_page=lists";
const HOSTS: [&str; 2] = ["127.0.0.1:3017", "localhost:3017"];
const LIMIT: usize = 2_000_000;
const CSP: &str = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
#[link(name="bcrypt")] extern "system" { fn BCryptGenRandom(alg:*mut std::ffi::c_void, buffer:*mut u8, length:u32, flags:u32)->i32; }
struct Request { method:String, path:String, headers:HashMap<String,String>, body:Vec<u8> }
fn read_request(stream:&TcpStream)->Result<Request,String> {
    stream.set_nonblocking(false).map_err(|e|e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e|e.to_string())?;
    let mut reader=BufReader::new(stream); let mut line=String::new();
    reader.by_ref().take(8193).read_line(&mut line).map_err(|e|e.to_string())?;
    let parts:Vec<_>=line.split_whitespace().collect();
    if parts.len()!=3 || parts[2]!="HTTP/1.1" || line.len()>8192 {return Err("Invalid request".into());}
    let method=parts[0].to_string(); let path=parts[1].to_string(); let mut headers=HashMap::new(); let mut total=line.len();
    loop {
        line.clear(); reader.by_ref().take(8193).read_line(&mut line).map_err(|e|e.to_string())?; total+=line.len();
        if total>16384 || line.is_empty() {return Err("Invalid headers".into());}
        if line=="\r\n" {break;}
        let (key,value)=line.split_once(':').ok_or("Invalid header")?;
        let key=key.trim().to_ascii_lowercase();
        if headers.insert(key,value.trim().to_string()).is_some() {return Err("Duplicate header".into());}
    }
    if headers.contains_key("transfer-encoding") {return Err("Transfer encoding is unsupported".into());}
    let length=headers.get("content-length").map(|v|v.parse::<usize>().map_err(|_|"Invalid length")).transpose()?.unwrap_or(0);
    if length>LIMIT {return Err("Request is too large".into());}
    let mut body=vec![0;length]; reader.read_exact(&mut body).map_err(|e|e.to_string())?;
    Ok(Request{method,path,headers,body})
}
fn reply(stream:&mut TcpStream,status:u16,value:Value) {
    let body=serde_json::to_vec(&value).unwrap_or_default();
    let _=stream.set_write_timeout(Some(Duration::from_secs(10)));
    let _=write!(stream,"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\n\r\n",body.len());
    let _=stream.write_all(&body); let _=stream.flush();
}
fn percent_decode(text:&str)->Option<String> {
    let bytes=text.as_bytes(); let mut out=Vec::with_capacity(bytes.len()); let mut i=0;
    while i<bytes.len() {
        if bytes[i]==b'%' {
            let hex=std::str::from_utf8(bytes.get(i+1..i+3)?).ok()?;
            out.push(u8::from_str_radix(hex,16).ok()?); i+=3;
        } else { out.push(bytes[i]); i+=1; }
    }
    String::from_utf8(out).ok()
}
/// Maps a URL path to a file under `root`. Missing extensionless paths fall back to
/// index.html (the page handles its own views); anything escaping `root` is refused.
pub(crate) fn static_path(root:&Path,route:&str)->Option<PathBuf> {
    let decoded=percent_decode(route)?;
    let mut path=root.to_path_buf(); let mut last="";
    for part in decoded.split('/').filter(|p|!p.is_empty()) {
        if part=="."||part==".."||part.contains(['\\',':','\0']) {return None;}
        path.push(part); last=part;
    }
    if path.is_file() {return Some(path);}
    if last.contains('.') {return None;}
    Some(root.join("index.html"))
}
fn static_type(path:&Path)->&'static str {
    match path.extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase().as_str() {
        "html"=>"text/html; charset=utf-8", "js"=>"text/javascript; charset=utf-8", "css"=>"text/css; charset=utf-8",
        "png"=>"image/png", "jpg"|"jpeg"=>"image/jpeg", "svg"=>"image/svg+xml", "ico"=>"image/x-icon", "webp"=>"image/webp",
        "json"=>"application/json", "woff2"=>"font/woff2", "txt"=>"text/plain; charset=utf-8", _=>"application/octet-stream",
    }
}
fn serve_static(stream:&mut TcpStream,root:&Path,route:&str,head_only:bool) {
    let found=static_path(root,route).and_then(|p|fs::read(&p).ok().map(|b|(p,b)));
    let _=stream.set_write_timeout(Some(Duration::from_secs(10)));
    let Some((path,bytes))=found else {
        let _=write!(stream,"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot found");
        return;
    };
    let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {CSP}\r\n\r\n",static_type(&path),bytes.len());
    if !head_only {let _=stream.write_all(&bytes);}
    let _=stream.flush();
}
fn handle(mut stream:TcpStream,store:&Store,token:&str,stopping:&AtomicBool) {
    let r=match read_request(&stream) {Ok(r)=>r,Err(e)=>{reply(&mut stream,400,json!({"error":e}));return;}};
    let host=r.headers.get("host").map(String::as_str).unwrap_or("");
    if !HOSTS.contains(&host) {reply(&mut stream,403,json!({"error":"Untrusted host"}));return;}
    if !r.path.starts_with('/') {reply(&mut stream,400,json!({"error":"Invalid path"}));return;}
    let route=r.path.split_once('?').map(|(a,_)|a).unwrap_or(r.path.as_str());
    if r.method=="GET" && route=="/health" {reply(&mut stream,200,json!({"app":"Everywhere","version":VERSION}));return;}
    if r.headers.get("origin").is_some_and(|o|o!=ORIGIN) {reply(&mut stream,403,json!({"error":"Untrusted origin"}));return;}
    if !matches!(route,"/session"|"/rpc"|"/media"|"/preview") {
        if r.method!="GET" && r.method!="HEAD" {reply(&mut stream,405,json!({"error":"Method not allowed"}));return;}
        // One origin keeps the page's browser storage in one place.
        if host!=HOSTS[0] {
            let _=write!(stream,"HTTP/1.1 308 Permanent Redirect\r\nLocation: {ORIGIN}{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",r.path);
            return;
        }
        serve_static(&mut stream,&store.web,route,r.method=="HEAD");
        return;
    }
    // API: only this page (same-origin) or a non-browser local client may call it.
    if !matches!(r.headers.get("sec-fetch-site").map(String::as_str),None|Some("same-origin")) {reply(&mut stream,403,json!({"error":"Cross-site request refused"}));return;}
    if r.method=="GET" && (route=="/media" || route=="/preview") {
        let args=media::query(&r.path);
        if args.get("t").map(String::as_str)!=Some(token) {media::plain(&mut stream,"403 Forbidden","Session expired. Reload Everywhere.","");return;}
        media::spawn(stream,route=="/preview",args,r.headers.get("range").cloned(),String::new());
        return;
    }
    if r.method=="GET" && route=="/session" {reply(&mut stream,200,json!({"token":token}));return;}
    if r.method!="POST" || route!="/rpc" {reply(&mut stream,404,json!({"error":"Unknown route"}));return;}
    if r.headers.get("x-everywhere-token").map(String::as_str)!=Some(token) {reply(&mut stream,403,json!({"error":"Session expired. Reload Everywhere."}));return;}
    if !r.headers.get("content-type").is_some_and(|v|v.starts_with("application/json")) {reply(&mut stream,415,json!({"error":"Use JSON"}));return;}
    let input:Value=match serde_json::from_slice(&r.body) {Ok(v)=>v,Err(_)=>{reply(&mut stream,400,json!({"error":"Invalid JSON"}));return;}};
    let result=dispatch(&input,store,stopping);
    match result {Ok(v)=>reply(&mut stream,200,json!({"result":v})),Err(e)=>reply(&mut stream,400,json!({"error":e}))}
}
fn dispatch(input:&Value,store:&Store,stopping:&AtomicBool)->Result<Value,String> {
    let args=&input["args"];
    let path=||args["path"].as_str().ok_or_else(||"Missing path".to_string());
    let offset=args["offset"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    let sort=args["sort"].as_str().unwrap_or("Name");
    let serialize=|v:Startup|serde_json::to_value(v).map_err(|e|e.to_string());
    match input["command"].as_str().unwrap_or("") {
        "startup"=>serialize(startup(store)),
        "search_tags"=>Ok(categories::tag_options()),
        "list_folder"=>serde_json::to_value(folder_page(path()?,"All",sort,offset as usize,100)?).map_err(|e|e.to_string()),
        "search_files"=>{
            let q=args["query"].as_str().unwrap_or(""); if q.len()>8192{return Err("Search is too long".into());}
            let folder=args["folder"].as_str();
            let mut sdk=store.sdk.lock().map_err(|_|"Search needs a restart")?;
            serde_json::to_value(sdk.query_scoped(q,folder,"All",sort,offset,args["currentFolder"].as_str())?).map_err(|e|e.to_string())
        },
        // How many folders a ## tag names (0, 1, or 2 for two or more), for search-box colors.
        "folder_tag_count"=>{
            let tag=args["tag"].as_str().ok_or("Missing tag")?; if tag.len()>1000{return Err("Tag is too long".into());}
            let mut sdk=store.sdk.lock().map_err(|_|"Search needs a restart")?;
            Ok(json!(sdk.folder_tag_count(tag,args["currentFolder"].as_str())?))
        },
        "thumbnail"=>serde_json::to_value(thumbnails::get(path()?)?).map_err(|e|e.to_string()),
        "text_preview"=>Ok(json!(text_preview(path()?.to_string())?)),
        "choose_folder"=>Ok(json!(rfd::FileDialog::new().set_title("Choose a folder for Everywhere").pick_folder().map(|p|p.to_string_lossy().into_owned()))),
        "open_file"=>{open_file(path()?.to_string())?;Ok(Value::Null)},
        "open_in_explorer"=>{open_in_explorer(path()?.to_string())?;Ok(Value::Null)},
        "reveal_file"=>{reveal_file(path()?.to_string())?;Ok(Value::Null)},
        "recycle_file"=>{recycle_file(path()?.to_string())?;Ok(Value::Null)},
        "rename_item"=>serde_json::to_value(rename_item(path()?,args["name"].as_str().ok_or("Missing new name")?)?).map_err(|e|e.to_string()),
        "start_everything"=>{start_everything()?;Ok(Value::Null)},
        "load_settings"=>Ok(load_settings(store)),
        "settings_location"=>Ok(json!(store.settings)),
        "save_settings"=>{if !args["value"].is_object(){return Err("Settings must be an object".into());}save_settings(args["value"].clone(),store)?;Ok(Value::Null)},
        "stop"=>{stopping.store(true,Ordering::SeqCst);Ok(Value::Null)},
        _=>Err("Unknown command".into())
    }
}
pub fn bind()->std::io::Result<TcpListener> { TcpListener::bind(("127.0.0.1",PORT)) }
/// Optional first-run import: when EVERYWHERE_IMPORT_SETTINGS names a settings.json (for
/// example ScratchPad's), its collections, search groups and preferences are copied once.
/// The source file is only read. Nothing is imported automatically.
fn import_settings(store:&Store)->Result<(),String> {
    if store.settings.exists() {return Ok(());}
    let Some(source)=std::env::var_os("EVERYWHERE_IMPORT_SETTINGS").map(PathBuf::from) else {return Ok(())};
    if let Ok(value)=fs::read(&source).map_err(|_|()).and_then(|b|serde_json::from_slice::<Value>(&b).map_err(|_|())) {
        if value.is_object() {save_settings(value,store)?;}
    }
    Ok(())
}
/// Serves until Menu > Quit (or `Everywhere.exe --quit`). `ready` runs once the
/// settings and Everything connection are loaded, just before connections are accepted.
pub fn run(listener:TcpListener,root:&Path,ready:impl FnOnce())->Result<(),String> {
    listener.set_nonblocking(true).map_err(|e|e.to_string())?;
    let dir=root.join("data");
    fs::create_dir_all(&dir).map_err(|e|format!("Could not create {}: {e}",dir.display()))?;
    let web=root.join("web");
    if !web.join("index.html").is_file() {return Err(format!("The page files are missing: {}",web.display()));}
    let sdk=everything::Sdk::load(&root.join("Everything64.dll")).map_err(|e|format!("Could not load Everything64.dll: {e}"))?;
    let store=Arc::new(Store{settings:dir.join("settings.json"),web,save_lock:Mutex::new(()),sdk:Mutex::new(sdk)});
    import_settings(&store)?;
    let mut bytes=[0u8;32]; if unsafe{BCryptGenRandom(std::ptr::null_mut(),bytes.as_mut_ptr(),32,2)}<0{return Err("Could not create local session".into());}
    let token=Arc::new(bytes.iter().map(|b|format!("{b:02x}")).collect::<String>());
    let stopping=Arc::new(AtomicBool::new(false));
    let (sender,receiver)=mpsc::sync_channel::<TcpStream>(24); let receiver=Arc::new(Mutex::new(receiver)); let mut workers=Vec::new();
    for _ in 0..8 {
        let receiver=receiver.clone();let store=store.clone();let token=token.clone();let stopping=stopping.clone();
        workers.push(std::thread::spawn(move||loop{let connection=receiver.lock().unwrap().recv();match connection{Ok(stream)=>handle(stream,&store,&token,&stopping),Err(_)=>break,}}));
    }
    ready();
    while !stopping.load(Ordering::SeqCst) {
        match listener.accept(){Ok((mut stream,_))=>{if let Err(mpsc::TrySendError::Full(s))=sender.try_send(stream.try_clone().map_err(|e|e.to_string())?){drop(s);reply(&mut stream,503,json!({"error":"Everywhere is busy. Retry shortly."}));}},Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(50)),Err(e)=>return Err(e.to_string())}
    }
    drop(sender);for worker in workers{let _=worker.join();}Ok(())
}
/// Minimal HTTP client for talking to an already-running Everywhere.
fn local_call(method:&str,path:&str,headers:&str,body:&str)->Option<(u16,String)> {
    let mut s=TcpStream::connect_timeout(&std::net::SocketAddr::from(([127,0,0,1],PORT)),Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    write!(s,"{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",body.len()).ok()?;
    let mut out=String::new(); s.read_to_string(&mut out).ok()?;
    let status=out.split_whitespace().nth(1)?.parse().ok()?;
    Some((status,out.split_once("\r\n\r\n").map(|x|x.1.to_string()).unwrap_or_default()))
}
pub fn running_instance()->bool {
    local_call("GET","/health","","").filter(|(s,_)|*s==200)
        .and_then(|(_,b)|serde_json::from_str::<Value>(&b).ok()).is_some_and(|v|v["app"]=="Everywhere")
}
pub fn quit_running()->bool {
    let Some(token)=local_call("GET","/session","","").and_then(|(_,b)|serde_json::from_str::<Value>(&b).ok()).and_then(|v|v["token"].as_str().map(String::from)) else {return false};
    let headers=format!("Content-Type: application/json\r\nX-Everywhere-Token: {token}\r\n");
    local_call("POST","/rpc",&headers,r#"{"command":"stop","args":{}}"#).is_some_and(|(s,_)|s==200)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn static_paths_stay_inside_the_page_folder() {
        let root=std::env::temp_dir().join(format!("everywhere-web-{}",std::process::id()));
        fs::create_dir_all(root.join("shared")).unwrap();
        fs::write(root.join("index.html"),"i").unwrap(); fs::write(root.join("shared").join("a.js"),"a").unwrap();
        assert_eq!(static_path(&root,"/shared/a.js"),Some(root.join("shared").join("a.js")));
        assert_eq!(static_path(&root,"/"),Some(root.join("index.html")));
        assert_eq!(static_path(&root,"/folder/view"),Some(root.join("index.html")));
        for bad in ["/../secret.txt","/shared/..%2F..%2Fx","/%2e%2e/x","/C:/Windows/win.ini","/a%5Cb","/missing.js","/%zz"] {assert_eq!(static_path(&root,bad),None,"{bad}");}
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn percent_decoding_handles_utf8() { assert_eq!(percent_decode("/r%C3%A9sum%C3%A9").as_deref(),Some("/résumé")); assert!(percent_decode("/%E9").is_none()); }
}
