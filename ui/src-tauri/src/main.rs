#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    // AppRun injects Python paths for bundled GTK tools. This Rust host uses
    // a separately managed interpreter and may open Python-based system
    // utilities (including a user's BROWSER). Clear these before threads start.
    if std::env::var_os("APPIMAGE").is_some() {
        std::env::remove_var("PYTHONHOME");
        std::env::remove_var("PYTHONPATH");
    }
    cue_studio_desktop::run();
}
