//! Windows Shell thumbnails are extracted off the UI thread. All COM and GDI
//! resources are released before returning an encoded, immutable preview.
use base64::Engine;
use serde::Serialize;
use std::{ffi::c_void, fs, io::Cursor, os::windows::fs::MetadataExt, path::Path, ptr, sync::{Mutex, OnceLock}};
#[derive(Clone, Serialize)]
pub struct Preview { pub data: String, pub width: u32, pub height: u32, pub icon: bool }
static CACHE: OnceLock<Mutex<std::collections::VecDeque<(String, Option<Preview>)>>> = OnceLock::new();
#[repr(C)] struct Guid { a:u32, b:u16, c:u16, d:[u8;8] }
#[repr(C)] #[derive(Clone,Copy)] struct Size { x:i32, y:i32 }
#[repr(C)] struct Factory { table:*const VTable }
#[repr(C)] struct VTable {
    query:usize, add_ref:usize,
    release: unsafe extern "system" fn(*mut Factory) -> u32,
    get_image: unsafe extern "system" fn(*mut Factory, Size, u32, *mut *mut c_void) -> i32,
}
#[repr(C)] #[derive(Default)] struct Bitmap { kind:i32, width:i32, height:i32, width_bytes:i32, planes:u16, bits_pixel:u16, bits:*mut c_void }
#[repr(C)] #[derive(Default)] struct Header { size:u32, width:i32, height:i32, planes:u16, bit_count:u16, compression:u32, size_image:u32, x:i32, y:i32, clr_used:u32, clr_important:u32 }
#[repr(C)] #[derive(Default)] struct Info { header:Header, colors:[u32;1] }
#[link(name="ole32")] extern "system" { fn CoInitializeEx(p:*mut c_void, flags:u32)->i32; fn CoUninitialize(); }
#[link(name="shell32")] extern "system" { fn SHCreateItemFromParsingName(name:*const u16,ctx:*mut c_void,id:*const Guid,out:*mut *mut Factory)->i32; }
#[link(name="gdi32")] extern "system" {
    fn GetObjectW(obj:*mut c_void,size:i32,out:*mut Bitmap)->i32;
    fn DeleteObject(obj:*mut c_void)->i32;
    fn CreateCompatibleDC(dc:*mut c_void)->*mut c_void;
    fn DeleteDC(dc:*mut c_void)->i32;
    fn GetDIBits(dc:*mut c_void,bmp:*mut c_void,start:u32,lines:u32,bits:*mut u8,info:*mut Info,usage:u32)->i32;
}
struct Com;
impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
struct Object(*mut Factory);
impl Drop for Object { fn drop(&mut self) { unsafe { ((*(*self.0).table).release)(self.0); } } }
struct Gdi(*mut c_void);
impl Drop for Gdi { fn drop(&mut self) { unsafe { DeleteObject(self.0); } } }
struct Dc(*mut c_void);
impl Drop for Dc { fn drop(&mut self) { unsafe { DeleteDC(self.0); } } }
pub fn get(path:&str) -> Result<Option<Preview>,String> {
    let p = Path::new(path);
    if !p.is_absolute() { return Err("Invalid preview path.".into()); }
    let m = fs::metadata(p).map_err(|e|e.to_string())?;
    if m.is_dir() || m.file_attributes() & (0x1000|0x400000) != 0 { return Ok(None); }
    let key = format!("{}:{}:{:?}",path,m.len(),m.modified().ok());
    let cache = CACHE.get_or_init(|| Mutex::new(std::collections::VecDeque::new()));
    if let Ok(mut c) = cache.lock() {
        if let Some(i) = c.iter().position(|(k,_)|k == &key) { let pair=c.remove(i).unwrap(); let value=pair.1.clone(); c.push_back(pair); return Ok(value); }
    }
    let owned = path.to_string();
    let preview = std::thread::spawn(move || extract(&owned)).join().map_err(|_|"Preview worker failed")??;
    if let Ok(mut c) = cache.lock() { c.push_back((key,preview.clone())); while c.len() > 180 { c.pop_front(); } }
    Ok(preview)
}
fn extract(path:&str) -> Result<Option<Preview>,String> {
    unsafe {
        if CoInitializeEx(ptr::null_mut(),2) < 0 { return Ok(None); }
        let _com = Com;
        let wide:Vec<_> = path.encode_utf16().chain(Some(0)).collect();
        let id=Guid{a:0xbcc18b79,b:0xba16,c:0x442f,d:[0x80,0xc4,0x8a,0x59,0xc3,0x0c,0x46,0x3b]};
        let mut factory=ptr::null_mut();
        if SHCreateItemFromParsingName(wide.as_ptr(),ptr::null_mut(),&id,&mut factory)<0 || factory.is_null() { return Ok(None); }
        let object=Object(factory);
        let mut bmp=ptr::null_mut();
        // EXEs expose their application icon rather than a document thumbnail.
        // Extract through the Shell without launching the executable.
        let icon = Path::new(path).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
        let (size, flags) = if icon { (128, 4) } else { (420, 8) };
        if ((*(*object.0).table).get_image)(object.0,Size{x:size,y:size},flags,&mut bmp)<0 || bmp.is_null() { return Ok(None); }
        let bitmap=Gdi(bmp);
        let mut b=Bitmap::default();
        if GetObjectW(bitmap.0,std::mem::size_of::<Bitmap>() as i32,&mut b)==0 || b.width<=0 || b.height<=0 || b.width>4096 || b.height>4096 { return Ok(None); }
        let dc=Dc(CreateCompatibleDC(ptr::null_mut()));
        if dc.0.is_null() { return Ok(None); }
        let mut info=Info{header:Header{size:40,width:b.width,height:-b.height,planes:1,bit_count:32,..Default::default()},..Default::default()};
        let mut bytes=vec![0u8;(b.width*b.height*4) as usize];
        if GetDIBits(dc.0,bitmap.0,0,b.height as u32,bytes.as_mut_ptr(),&mut info,0)==0 { return Ok(None); }
        let alpha_empty=bytes.chunks_exact(4).all(|p|p[3]==0);
        for pixel in bytes.chunks_exact_mut(4) { pixel.swap(0,2); if alpha_empty { pixel[3]=255; } }
        let rgba=image::RgbaImage::from_raw(b.width as u32,b.height as u32,bytes).ok_or("Preview encoding failed")?;
        let mut png=Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(rgba).write_to(&mut png,image::ImageFormat::Png).map_err(|e|e.to_string())?;
        Ok(Some(Preview{data:format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png.into_inner())),width:b.width as u32,height:b.height as u32,icon}))
    }
}
