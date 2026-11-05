use crate::supervisor::{Backend, RuntimeConfig, RuntimeStatus};
use std::{path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

struct Desktop {
    backend: Option<Backend>,
    status: RuntimeStatus,
    root: Option<PathBuf>,
    data: PathBuf,
    resources: PathBuf,
}
#[derive(Clone)]
struct State(Arc<Mutex<Desktop>>);

#[tauri::command]
fn desktop_status(state: tauri::State<'_, State>) -> RuntimeStatus {
    let desktop = state.0.lock().unwrap();
    desktop.backend.as_ref().map(|b| b.status.clone()).unwrap_or_else(|| desktop.status.clone())
}

fn start(app: tauri::AppHandle, state: State) {
    std::thread::spawn(move || {
        {
            let mut desktop = state.0.lock().unwrap();
            if desktop.backend.is_some() { return; }
            let root = desktop.root.clone().unwrap_or_else(|| desktop.resources.join("runtime"));
            let app_dir = root.join("app");
            let python = std::env::var_os("CUE_DESKTOP_PYTHON").map(PathBuf::from)
                .unwrap_or_else(|| app_dir.join(if cfg!(windows) { "env/Scripts/python.exe" } else { "env/bin/python" }));
            let web_dir = if root.join("ui/dist/index.html").is_file() { root.join("ui/dist") } else { desktop.resources.join("web") };
            let config = RuntimeConfig { python, app_dir, web_dir, data_dir: desktop.data.clone() };
            match Backend::spawn(&config) {
                Ok(backend) => desktop.backend = Some(backend),
                Err(message) => { desktop.status.phase = "setup-required".into(); desktop.status.message = message; return; }
            }
        }
        loop {
            let result = {
                let mut desktop = state.0.lock().unwrap();
                let Some(backend) = desktop.backend.as_mut() else { return; };
                backend.poll()
            };
            match result {
                Ok(Some(url)) => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(url) = url.parse() { let _ = window.navigate(url); }
                    }
                }
                Ok(None) => {}
                Err(message) => {
                    {
                        let mut desktop = state.0.lock().unwrap();
                        desktop.backend.take(); desktop.status.phase = "failed".into(); desktop.status.message = message;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let url = if cfg!(debug_assertions) { "http://localhost:3000/desktop.html" } else { "tauri://localhost/desktop.html" };
                        if let Ok(url) = url.parse() { let _ = window.navigate(url); }
                    }
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

#[tauri::command]
fn desktop_retry(app: tauri::AppHandle, state: tauri::State<'_, State>) { start(app, state.inner().clone()); }

#[tauri::command]
async fn desktop_choose_runtime(app: tauri::AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    let selected = app.dialog().file().set_title("Select the Cue Studio runtime folder").blocking_pick_folder();
    if let Some(path) = selected {
        let path = path.into_path().map_err(|e| e.to_string())?;
        if !path.join("app/desktop_worker.py").is_file() { return Err("This folder does not contain the Cue Studio runtime".into()); }
        {
            let mut desktop = state.0.lock().unwrap();
            std::fs::write(desktop.data.join("runtime-location.json"), serde_json::to_vec(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            desktop.root = Some(path);
        }
        start(app, state.inner().clone());
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_status, desktop_retry, desktop_choose_runtime])
        .setup(|app| {
            let data = std::env::var_os("CUE_DESKTOP_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            let root = std::env::var_os("CUE_DESKTOP_RUNTIME_ROOT").map(PathBuf::from)
                .or_else(|| std::fs::read(data.join("runtime-location.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()))
                .or_else(|| if cfg!(debug_assertions) { Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")) } else { None });
            let state = State(Arc::new(Mutex::new(Desktop { backend: None, root, data: data.clone(), resources: app.path().resource_dir()?,
                status: RuntimeStatus { phase: "starting".into(), message: "Preparing Cue Studio…".into(), pid: None, port: None,
                    log_path: data.join("desktop-worker.log").to_string_lossy().into() } })));
            app.manage(state.clone()); start(app.handle().clone(), state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<State>();
                if state.0.lock().unwrap().backend.is_some() {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    let state = state.inner().clone();
                    app.dialog().message("Quit Cue Studio and stop its local AI engine? Active generations will be interrupted.")
                        .title("Quit Cue Studio").buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel).show(move |confirmed| {
                            if confirmed {
                                std::thread::spawn(move || { state.0.lock().unwrap().backend.take(); app.exit(0); });
                            }
                        });
                }
            }
        })
        .build(tauri::generate_context!()).expect("Unable to initialize Cue Studio desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event { app.state::<State>().0.lock().unwrap().backend.take(); }
        });
}
