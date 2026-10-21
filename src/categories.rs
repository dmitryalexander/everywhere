// Keep search filters and file labels on the same extension lists.
pub const TYPES: &[(&str, &str)] = &[
    ("Images", "jpg;jpeg;jpe;jfif;png;gif;webp;avif;bmp;dib;tif;tiff;heic;heif;svg;ico;raw;cr2;cr3;nef;arw;dng;psd;exr;jxl"),
    ("Videos", "mp4;mkv;mov;webm;avi;wmv;m4v;mpeg;mpg;mpe;mpv;3gp;3g2;flv;vob;ogv;mts;m2ts;asf"),
    ("Audio", "mp3;flac;wav;ogg;m4a;aac;opus;wma;aiff;aif;alac;mid;midi"),
    ("Documents", "pdf;doc;docx;docm;dot;dotx;ppt;pptx;xls;xlsx;odt;ods;odp;rtf;epub;txt;text;md;markdown;mdown;mdx;rst;log;csv;tsv;tex;org;pages"),
    ("Code", "rs;py;pyw;pyi;js;jsx;mjs;cjs;ts;tsx;html;htm;css;scss;sass;less;json;jsonc;yaml;yml;toml;c;cpp;cc;cxx;h;hpp;hxx;cs;go;ps1;psm1;psd1;sql;xml;java;kt;kts;swift;rb;php;lua;sh;bash;zsh;bat;cmd;vue;svelte;dart;r;ipynb;ex;exs;erl;hrl;hs;clj;cljs;cljc;fs;fsx;vb;vbs;pl;pm;scala;sc;groovy;gradle;ini;cfg;conf;graphql;gql;proto;asm;s"),
    ("Archives", "zip;7z;rar;tar;gz;bz2;iso;xz;zst"),
    ("Programs", "exe;msi;msix;msixbundle;appx;appxbundle;com;scr"),
    ("Fonts", "ttf;otf;woff;woff2;eot"),
    ("Data", "db;sqlite;sqlite3;parquet;arrow;feather"),
];

// Extension names take precedence over broad aliases: #doc means .doc,
// while #docs means all documents. Keep help and search on this registry.
pub const ALIASES: &[(&str, &str)] = &[
    ("Folders", "folder;folders;dir;dirs;directory;directories"),
    ("Files", "file;files"),
    ("Images", "img;imgs;image;images;pic;pics;picture;pictures;photo;photos;photograph;photographs"),
    ("Videos", "vid;vids;video;videos;movie;movies;clip;clips"),
    ("Audio", "audio;audios;music;sound;sounds;song;songs"),
    ("Documents", "document;documents;docs"),
    ("Code", "code;codes;script;scripts;source;sources;programming"),
    ("Archives", "archive;archives;compressed;compression"),
    ("Programs", "app;apps;application;applications;program;programs;executable;executables"),
    ("Fonts", "font;fonts;typeface;typefaces"),
    ("Data", "data;database;databases;dataset;datasets"),
];
pub const EXTRA_EXTENSIONS: &str = "dll;sys;lnk;url;torrent;bak;tmp;dat;bin;cab;img;vhd;vhdx;vdi;vmdk;deb;rpm;apk;dmg;pkg;bat;cmd;ps1;psm1;psd1;ics;vcf;odg;key;numbers;one;onenote;azw;azw3;mobi;cbz;cbr;fb2;xlsm;xlt;xltx;xltm;pptm;pot;potx;potm;pps;ppsx;ppsm;ott;ots;otp;rtfd;djvu;heic;heif;3gpp;mpeg4;ts;wavpack;ape;amr;au;7zip;tgz;tbz;tbz2;txz;lz;lzma;lz4;br;svgz;eps;ai;indd;xcf;blend;obj;stl;fbx;gltf;glb;3mf;dwg;dxf;step;stp";

pub fn extension_tags() -> Vec<&'static str> {
    let mut tags: Vec<_> = TYPES.iter().flat_map(|(_, exts)| exts.split(';'))
        .chain(EXTRA_EXTENSIONS.split(';')).collect();
    tags.sort_unstable(); tags.dedup(); tags
}

pub fn extensions(kind: &str) -> Option<&'static str> {
    TYPES.iter().find(|(name, _)| *name == kind).map(|(_, exts)| *exts)
}

pub fn category(ext: &str) -> &'static str {
    TYPES.iter().find(|(_, exts)| exts.split(';').any(|e| e == ext))
        .map(|(name, _)| *name).unwrap_or("Other")
}

pub fn hashtag(tag: &str) -> Option<&'static str> {
    ALIASES.iter().find(|(_, tags)| tags.split(';').any(|alias| alias.eq_ignore_ascii_case(tag)))
        .map(|(kind, _)| *kind)
}

pub fn tag_constraint(tag: &str) -> Option<String> {
    let tag = tag.to_ascii_lowercase();
    // #img is deliberately the image alias; every other listed extension is exact.
    if tag != "img" && (TYPES.iter().any(|(_, exts)| exts.split(';').any(|ext| ext == tag))
        || EXTRA_EXTENSIONS.split(';').any(|ext| ext == tag)) {
        return Some(format!("file: ext:{tag}"));
    }
    hashtag(&tag).map(constraint)
}

pub fn tag_options() -> serde_json::Value {
    serde_json::json!({
        "groups": ALIASES.iter().map(|(name, tags)| serde_json::json!({"name":name,"tags":tags.split(';').collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "extensions": extension_tags().into_iter().filter(|ext| *ext != "img").collect::<Vec<_>>()
    })
}

pub fn constraint(kind: &str) -> String {
    if kind == "Folders" { return "folder:".into(); }
    if kind == "Files" { return "file:".into(); }
    extensions(kind).map(|exts| format!("file: ext:{exts}")).unwrap_or_default()
}
