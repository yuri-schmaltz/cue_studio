use crate::supervisor::{Backend, RuntimeConfig, RuntimeStatus};
use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

struct Desktop {
    backend: Option<Backend>,
    status: RuntimeStatus,
    root: Option<PathBuf>,
    data: PathBuf,
    resources: PathBuf,
    installing: bool,
    generation: u64,
}
#[derive(Clone)]
struct State(Arc<Mutex<Desktop>>);

#[tauri::command]
fn desktop_status(state: tauri::State<'_, State>) -> RuntimeStatus {
    let desktop = state.0.lock().unwrap();
    desktop
        .backend
        .as_ref()
        .map(|b| b.status.clone())
        .unwrap_or_else(|| desktop.status.clone())
}

fn start(app: tauri::AppHandle, state: State) {
    std::thread::spawn(move || {
        let generation;
        {
            let mut desktop = state.0.lock().unwrap();
            if desktop.backend.is_some() || desktop.installing {
                return;
            }
            let root = desktop
                .root
                .clone()
                .unwrap_or_else(|| desktop.resources.join("runtime"));
            let managed_ready = crate::runtime::managed_ready(&desktop.data, &root.join("app"));
            let app_dir = if managed_ready {
                desktop.data.join("runtime/app")
            } else {
                root.join("app")
            };
            let managed_python = desktop.data.join("runtime").join(if cfg!(windows) {
                "env/Scripts/python.exe"
            } else {
                "env/bin/python"
            });
            let python = std::env::var_os("CUE_DESKTOP_PYTHON")
                .map(PathBuf::from)
                .or_else(|| (managed_ready && managed_python.is_file()).then_some(managed_python))
                .unwrap_or_else(|| {
                    app_dir.join(if cfg!(windows) {
                        "env/Scripts/python.exe"
                    } else {
                        "env/bin/python"
                    })
                });
            let web_dir = if root.join("ui/dist/index.html").is_file() {
                root.join("ui/dist")
            } else {
                desktop.resources.join("web")
            };
            let config = RuntimeConfig {
                python,
                app_dir,
                web_dir,
                data_dir: desktop.data.clone(),
            };
            match Backend::spawn(&config) {
                Ok(backend) => {
                    desktop.backend = Some(backend);
                    desktop.generation += 1;
                    generation = desktop.generation;
                }
                Err(message) => {
                    desktop.status.phase = "setup-required".into();
                    desktop.status.message = message;
                    return;
                }
            }
        }
        loop {
            let result = {
                let mut desktop = state.0.lock().unwrap();
                if desktop.generation != generation {
                    return;
                }
                let Some(backend) = desktop.backend.as_mut() else {
                    return;
                };
                backend.poll()
            };
            match result {
                Ok(Some(url)) => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Ok(url) = url.parse() {
                            let _ = window.navigate(url);
                        }
                    }
                }
                Ok(None) => {}
                Err(message) => {
                    {
                        let mut desktop = state.0.lock().unwrap();
                        if desktop.generation != generation {
                            return;
                        }
                        desktop.backend.take();
                        desktop.status.phase = "failed".into();
                        desktop.status.message = message;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let url = if cfg!(debug_assertions) {
                            "http://localhost:3000/desktop.html"
                        } else {
                            "tauri://localhost/desktop.html"
                        };
                        if let Ok(url) = url.parse() {
                            let _ = window.navigate(url);
                        }
                    }
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

fn import_existing_workspace(app: tauri::AppHandle, state: State) {
    std::thread::spawn(move || {
        let running = state.0.lock().unwrap().backend.is_some();
        if running && !app.dialog().message("Import settings and reuse projects and models from an existing workspace? The local engine will restart and active generations will be interrupted. A backup of current settings will be saved.")
            .title("Import existing workspace").buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel).blocking_show() { return; }
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Select the existing Cue Studio workspace folder")
            .blocking_pick_folder()
        else {
            return;
        };
        let Ok(source) = selected.into_path() else {
            return;
        };
        let (script, data) = {
            let mut desktop = state.0.lock().unwrap();
            if desktop.installing {
                return;
            }
            desktop.generation += 1;
            desktop.backend.take();
            let root = desktop
                .root
                .clone()
                .unwrap_or_else(|| desktop.resources.join("runtime"));
            (root.join("app/desktop_import.py"), desktop.data.clone())
        };
        let result = Command::new(
            std::env::var_os("CUE_DESKTOP_BOOTSTRAP_PYTHON").unwrap_or_else(|| "python3".into()),
        )
        .arg(script)
        .arg("--source")
        .arg(source)
        .arg("--data")
        .arg(data)
        .output();
        let message = match result {
            Ok(output) if output.status.success() => "Workspace imported. Existing model and media files remain in their original locations.".to_string(),
            Ok(output) => format!("Import failed: {}", String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("unknown error")),
            Err(error) => format!("Import failed: {error}"),
        };
        app.dialog()
            .message(message)
            .title("Import existing workspace")
            .blocking_show();
        start(app, state);
    });
}

#[tauri::command]
fn desktop_import_workspace(app: tauri::AppHandle, state: tauri::State<'_, State>) {
    import_existing_workspace(app, state.inner().clone());
}

#[tauri::command]
fn desktop_retry(app: tauri::AppHandle, state: tauri::State<'_, State>) {
    start(app, state.inner().clone());
}

#[tauri::command]
fn desktop_install_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let (python, app_dir, runtime_dir) = {
        let mut desktop = state
            .0
            .lock()
            .map_err(|_| "Desktop state is unavailable".to_string())?;
        if desktop.installing {
            return Ok(());
        }
        if desktop.backend.is_some() {
            return Err("The AI engine is already running".into());
        }
        let root = desktop
            .root
            .clone()
            .unwrap_or_else(|| desktop.resources.join("runtime"));
        let app_dir = root.join("app");
        let python = std::env::var_os("CUE_DESKTOP_BOOTSTRAP_PYTHON")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("CUE_DESKTOP_PYTHON").map(PathBuf::from))
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    PathBuf::from("python")
                } else {
                    PathBuf::from("python3")
                }
            });
        desktop.installing = true;
        desktop.status.phase = "installing".into();
        desktop.status.message = "Installing the private Python AI runtime…".into();
        desktop.status.log_path = desktop
            .data
            .join("desktop-install.log")
            .to_string_lossy()
            .into();
        (python, app_dir, desktop.data.join("runtime"))
    };
    let next = state.inner().clone();
    std::thread::spawn(move || {
        let bootstrap = app_dir.join("runtime_bootstrap.py");
        let log_path = runtime_dir.parent().unwrap().join("desktop-install.log");
        let result = std::fs::File::create(&log_path)
            .map_err(|e| e.to_string())
            .and_then(|log| {
                let stderr = log.try_clone().map_err(|e| e.to_string())?;
                let mut installer = Command::new(&python);
                #[cfg(unix)]
                {
                    use std::os::unix::process::CommandExt;
                    installer.process_group(0);
                }
                installer
                    .env("CUE_DESKTOP_PARENT_PID", std::process::id().to_string())
                    .arg("-u")
                    .arg(&bootstrap)
                    .arg("--app-dir")
                    .arg(&app_dir)
                    .arg("--runtime-dir")
                    .arg(&runtime_dir)
                    .stdout(log)
                    .stderr(stderr)
                    .status()
                    .map_err(|e| format!("Could not start runtime installer: {e}"))
                    .and_then(|status| {
                        if status.success() {
                            Ok(())
                        } else {
                            Err(format!(
                                "Runtime installation failed. See {}",
                                log_path.display()
                            ))
                        }
                    })
            });
        let succeeded = result.is_ok();
        if let Ok(mut desktop) = next.0.lock() {
            desktop.installing = false;
            match result {
                Ok(()) => {
                    desktop.status.phase = "starting".into();
                    desktop.status.message =
                        "Runtime installed; starting the local AI engine…".into();
                }
                Err(message) => {
                    desktop.status.phase = "setup-required".into();
                    desktop.status.message = message;
                }
            }
        }
        if succeeded {
            start(app, next);
        }
    });
    Ok(())
}

#[tauri::command]
async fn desktop_choose_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select the Cue Studio runtime folder")
        .blocking_pick_folder();
    if let Some(path) = selected {
        let path = path.into_path().map_err(|e| e.to_string())?;
        if !path.join("app/desktop_worker.py").is_file() {
            return Err("This folder does not contain the Cue Studio runtime".into());
        }
        {
            let mut desktop = state.0.lock().unwrap();
            std::fs::write(
                desktop.data.join("runtime-location.json"),
                serde_json::to_vec(&path).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            desktop.root = Some(path);
        }
        start(app, state.inner().clone());
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("navigation")
            .on_navigation(|webview, url| {
                let port = webview.try_state::<State>().and_then(|state| {
                    state.0.lock().ok().and_then(|desktop| desktop.backend.as_ref().and_then(|backend| backend.status.port))
                });
                match crate::navigation::classify(url, port, cfg!(debug_assertions)) {
                    crate::navigation::Navigation::Internal => true,
                    crate::navigation::Navigation::External => {
                        let url = url.to_string();
                        std::thread::spawn(move || { let _ = opener::open_browser(url); });
                        false
                    }
                    crate::navigation::Navigation::Denied => false,
                }
            }).build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_status, desktop_retry, desktop_choose_runtime, desktop_install_runtime, desktop_import_workspace])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "import-workspace" {
                import_existing_workspace(app.clone(), app.state::<State>().inner().clone());
            }
        })
        .setup(|app| {
            let data = std::env::var_os("CUE_DESKTOP_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            let root = std::env::var_os("CUE_DESKTOP_RUNTIME_ROOT").map(PathBuf::from)
                .or_else(|| std::fs::read(data.join("runtime-location.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()))
                .or_else(|| if cfg!(debug_assertions) { Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")) } else { None });
            let menu = tauri::menu::MenuBuilder::new(app).text("import-workspace", "Import existing workspace…").build()?;
            app.set_menu(menu)?;
            let state = State(Arc::new(Mutex::new(Desktop { backend: None, root, data: data.clone(), resources: app.path().resource_dir()?, installing: false, generation: 0,
                status: RuntimeStatus { phase: "starting".into(), message: "Preparing Cue Studio…".into(), pid: None, port: None,
                    log_path: data.join("desktop-worker.log").to_string_lossy().into() } })));
            app.manage(state.clone());
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_new_window(|url, _| {
                    if crate::navigation::classify(&url, None, false) == crate::navigation::Navigation::External {
                        std::thread::spawn(move || { let _ = opener::open_browser(url.to_string()); });
                    }
                    tauri::webview::NewWindowResponse::Deny
                }).build()?;
            start(app.handle().clone(), state);
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
