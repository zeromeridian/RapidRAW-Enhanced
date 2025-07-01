use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let out_dir = env::var("OUT_DIR").unwrap();
    let cargo_target_dir = Path::new(&out_dir)
        .ancestors()
        .nth(3)
        .unwrap();

    let lib_name = {
        #[cfg(target_os = "windows")]
        { "onnxruntime.dll" }
        #[cfg(target_os = "linux")]
        { "libonnxruntime.so" } // untested, might have version numbers??
        #[cfg(target_os = "macos")]
        { "libonnxruntime.dylib" }
    };

    let source_path = cargo_target_dir.join(lib_name);
    let resources_dir = Path::new("resources");
    fs::create_dir_all(&resources_dir).unwrap();
    let dest_path = resources_dir.join(lib_name);

    if source_path.exists() {
        println!("cargo:warning=Found ONNX Runtime library at: {}", source_path.display());
        fs::copy(&source_path, &dest_path).unwrap();
        println!("cargo:warning=Copied ONNX Runtime library to: {}", dest_path.display());
    } else {
        println!("cargo:warning=Could not find ONNX Runtime library at: {}. It might be copied on a subsequent build.", source_path.display());
    }

    tauri_build::build()
}