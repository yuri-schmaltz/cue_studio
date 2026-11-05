//! Own exactly one private AI worker, never an unrelated localhost server.
use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, path::PathBuf, process::{Child, Command, Stdio}, time::{Duration, Instant}};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub python: PathBuf,
    pub app_dir: PathBuf,
    pub data_dir: PathBuf,
    pub web_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeStatus {
    pub phase: String,
    pub message: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub log_path: String,
}

#[derive(Deserialize)]
struct Ready { port: u16, pid: u32, instance: String }

pub struct Backend {
    child: Child,
    token: String,
    instance: String,
    ready_path: PathBuf,
    started: Instant,
    client: reqwest::blocking::Client,
    pub status: RuntimeStatus,
}

impl Backend {
    pub fn spawn(config: &RuntimeConfig) -> Result<Self, String> {
        let worker = config.app_dir.join("desktop_worker.py");
        if !config.python.is_file() || !worker.is_file() || !config.web_dir.join("index.html").is_file() {
            return Err("Runtime unavailable: select a Cue Studio runtime with Python dependencies and a built interface.".into());
        }
        fs::create_dir_all(&config.data_dir).map_err(|e| e.to_string())?;
        let instance = Uuid::new_v4().to_string();
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let ready_path = config.data_dir.join(format!("worker-{instance}.json"));
        let log_path = config.data_dir.join("desktop-worker.log");
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let log = options.open(&log_path).map_err(|e| e.to_string())?;
        let mut command = Command::new(&config.python);
        command.arg("-u").arg(&worker).current_dir(&config.app_dir)
            .env("CUE_DESKTOP_PARENT_PID", std::process::id().to_string())
            .env("CUE_DESKTOP_TOKEN", &token).env("CUE_DESKTOP_INSTANCE", &instance)
            .env("CUE_DESKTOP_DATA", &config.data_dir).env("CUE_DESKTOP_READY", &ready_path)
            .env("CUE_UI_DIST", &config.web_dir)
            .stdin(Stdio::null()).stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log));
        #[cfg(unix)] {
            use std::os::unix::process::CommandExt;
            // A distinct group lets shutdown clean up ffmpeg/other descendants
            // without signalling the user's browser, LLM or existing backend.
            let owner = std::process::id();
            unsafe { command.pre_exec(move || {
                #[cfg(target_os = "linux")]
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM, 0, 0, 0) == -1 { return Err(std::io::Error::last_os_error()); }
                if libc::getppid() as u32 != owner { return Err(std::io::Error::other("Desktop parent exited during startup")); }
                if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); }
                Ok(())
            }); }
        }
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let child = command.spawn().map_err(|e| format!("Cannot start AI runtime: {e}"))?;
        let pid = child.id();
        let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(1)).build().map_err(|e| e.to_string())?;
        Ok(Self { child, token, instance, ready_path, started: Instant::now(), client,
            status: RuntimeStatus { phase: "starting".into(), message: "Starting the local AI engine…".into(),
                pid: Some(pid), port: None, log_path: log_path.to_string_lossy().into() } })
    }

    /// Short polling calls keep the Tauri event loop responsive during imports.
    /// The URL is for Rust navigation only: never expose the session via IPC.
    pub fn poll(&mut self) -> Result<Option<String>, String> {
        if let Some(exit) = self.child.try_wait().map_err(|e| e.to_string())? {
            self.status.phase = "failed".into();
            self.status.message = format!("AI engine exited ({exit}). See {}", self.status.log_path);
            return Err(self.status.message.clone());
        }
        if self.status.phase == "ready" { return Ok(None); }
        if self.started.elapsed() > Duration::from_secs(300) {
            self.status.phase = "failed".into();
            self.status.message = "AI engine startup timed out. See the runtime log and retry.".into();
            return Err(self.status.message.clone());
        }
        let ready: Ready = match fs::read(&self.ready_path).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
            Some(value) => value, None => return Ok(None),
        };
        if ready.instance != self.instance || ready.pid != self.child.id() || ready.port == 0 {
            return Err("Worker readiness identity does not match the owned process".into());
        }
        let response = self.client.get(format!("http://127.0.0.1:{}/__desktop/status", ready.port))
            .header("x-cue-desktop-token", &self.token).send();
        let identity: serde_json::Value = match response.and_then(|r| r.error_for_status()).and_then(|r| r.json()) {
            Ok(value) => value, Err(_) => return Ok(None),
        };
        if identity["instance"].as_str() != Some(&self.instance) || identity["pid"].as_u64() != Some(self.child.id().into()) {
            return Err("HTTP runtime identity does not match the owned worker".into());
        }
        self.status.phase = "ready".into(); self.status.message = "Local AI engine ready".into();
        self.status.port = Some(ready.port);
        Ok(Some(format!("http://127.0.0.1:{}/__desktop/bootstrap/{}", ready.port, self.token)))
    }

    pub fn stop(&mut self) {
        if self.status.phase == "stopped" { return; }
        #[cfg(unix)] unsafe { libc::kill(-(self.child.id() as i32), libc::SIGTERM); }
        #[cfg(not(unix))] { let _ = self.child.kill(); }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if self.child.try_wait().ok().flatten().is_some() { break; }
            if Instant::now() >= deadline {
                #[cfg(unix)] unsafe { libc::kill(-(self.child.id() as i32), libc::SIGKILL); }
                let _ = self.child.kill(); let _ = self.child.wait(); break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = fs::remove_file(&self.ready_path);
        self.status.phase = "stopped".into(); self.status.pid = None; self.status.port = None;
    }
}
impl Drop for Backend { fn drop(&mut self) { self.stop(); } }

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    fn fixture(script: &str) -> (tempfile::TempDir, RuntimeConfig) {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app"); let web = root.path().join("web");
        fs::create_dir_all(&app).unwrap(); fs::create_dir_all(&web).unwrap();
        fs::write(app.join("desktop_worker.py"), script).unwrap(); fs::write(web.join("index.html"), "UI").unwrap();
        let python = std::env::var_os("CUE_TEST_PYTHON").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/usr/bin/python3"));
        let config = RuntimeConfig { python, app_dir: app, web_dir: web, data_dir: root.path().join("data") };
        (root, config)
    }

    #[test]
    fn worker_identity_is_verified_and_owned_process_is_reaped() {
        let (_root, config) = fixture(r#"
import http.server, os, json
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        good=self.headers.get('x-cue-desktop-token')==os.environ['CUE_DESKTOP_TOKEN']
        self.send_response(200 if good else 401); self.end_headers()
        self.wfile.write(json.dumps({'instance':os.environ['CUE_DESKTOP_INSTANCE'],'pid':os.getpid()}).encode())
server=http.server.HTTPServer(('127.0.0.1',0),Handler)
with open(os.environ['CUE_DESKTOP_READY'],'w') as f:
    json.dump({'port':server.server_port,'instance':os.environ['CUE_DESKTOP_INSTANCE'],'pid':os.getpid()},f)
server.serve_forever()
"#);
        let mut backend = Backend::spawn(&config).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(url) = backend.poll().unwrap() {
                assert!(url.starts_with("http://127.0.0.1:")); assert!(url.contains("/__desktop/bootstrap/")); break;
            }
            assert!(Instant::now() < deadline); sleep(Duration::from_millis(30));
        }
        assert_eq!(backend.status.phase, "ready");
        assert!(!serde_json::to_string(&backend.status).unwrap().contains(&backend.token));
        let ready_file = backend.ready_path.clone();
        backend.stop(); backend.stop();
        assert!(backend.child.try_wait().unwrap().is_some()); assert!(!ready_file.exists());
    }

    #[test]
    fn never_accepts_a_readiness_file_for_another_process() {
        let (_root, config) = fixture("import time; time.sleep(30)");
        let mut backend = Backend::spawn(&config).unwrap();
        fs::write(&backend.ready_path, format!(r#"{{"port":7860,"pid":1,"instance":"{}"}}"#, backend.instance)).unwrap();
        assert!(backend.poll().unwrap_err().contains("identity"));
    }

    #[test]
    fn early_exit_is_reported_instead_of_attaching_to_an_existing_server() {
        let (_root, config) = fixture("raise SystemExit(7)");
        let mut backend = Backend::spawn(&config).unwrap();
        sleep(Duration::from_millis(200));
        assert!(backend.poll().unwrap_err().contains("exited")); assert_eq!(backend.status.phase, "failed");
    }
}
