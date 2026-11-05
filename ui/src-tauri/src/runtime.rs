use std::path::Path;
use std::process::Command;

/// GTK AppRun hooks export paths for their own tools, not our AI interpreter.
pub fn isolate_python(command: &mut Command) {
    command
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env("PYTHONNOUSERSITE", "1");
}

/// Never boot a partial environment or one installed for an older packaged lock.
pub fn managed_ready(data: &Path, packaged_app: &Path) -> bool {
    fn read(path: &Path) -> Option<serde_json::Value> {
        serde_json::from_slice(&std::fs::read(path).ok()?).ok()
    }
    let Some(marker) = read(&data.join("runtime/runtime-ready.json")) else {
        return false;
    };
    let Some(manifest) = read(&packaged_app.join("runtime_manifest.json")) else {
        return false;
    };
    let Some(profile) = marker["profile"].as_str() else {
        return false;
    };
    let Some(expected) = manifest["locks"][profile]["sha256"].as_str() else {
        return false;
    };
    let Some(requirements) = manifest["requirementsSha256"].as_str() else {
        return false;
    };
    marker["lockSha256"].as_str() == Some(expected)
        && marker["requirementsSha256"].as_str() == Some(requirements)
        && data.join("runtime/app/desktop_worker.py").is_file()
}

/// A dependency-ready environment can still contain source from an older app.
pub fn sync_managed_source(data: &Path, packaged_app: &Path) -> Result<(), String> {
    let python = data.join("runtime/env/bin/python");
    let mut command = Command::new(python);
    isolate_python(&mut command);
    let output = command
        .arg(packaged_app.join("runtime_source.py"))
        .arg("--source")
        .arg(packaged_app)
        .arg("--destination")
        .arg(data.join("runtime/app"))
        .output()
        .map_err(|e| format!("Cannot update runtime source: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Cannot update runtime source: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn source_upgrade_runs_before_worker_and_preserves_private_files() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("package");
        let data = root.path().join("private");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(data.join("runtime/env/bin")).unwrap();
        std::fs::create_dir_all(data.join("runtime/app/models")).unwrap();
        std::os::unix::fs::symlink("/usr/bin/python3", data.join("runtime/env/bin/python"))
            .unwrap();
        std::fs::write(
            source.join("runtime_source.py"),
            include_str!("../../../app/runtime_source.py"),
        )
        .unwrap();
        std::fs::write(source.join("launch.py"), "new code").unwrap();
        let manifest = Command::new("python3").args(["-c", "import hashlib,json;print(json.dumps({'schema':1,'files':{'launch.py':hashlib.sha256(b'new code').hexdigest()}}))"]).output().unwrap();
        assert!(manifest.status.success());
        std::fs::write(source.join("runtime-code-manifest.json"), manifest.stdout).unwrap();
        std::fs::write(data.join("runtime/app/launch.py"), "old code").unwrap();
        std::fs::write(data.join("runtime/app/models/user.gguf"), "preserve").unwrap();
        sync_managed_source(&data, &source).unwrap();
        sync_managed_source(&data, &source).unwrap();
        assert_eq!(
            std::fs::read_to_string(data.join("runtime/app/launch.py")).unwrap(),
            "new code"
        );
        assert_eq!(
            std::fs::read_to_string(data.join("runtime/app/models/user.gguf")).unwrap(),
            "preserve"
        );
    }
    #[test]
    fn packaged_launcher_paths_do_not_replace_python_standard_library() {
        let mut command = Command::new("python3");
        command
            .env("PYTHONHOME", "/missing-appimage-python")
            .env("PYTHONPATH", "/missing-appimage-pyshared");
        isolate_python(&mut command);
        let output = command
            .args(["-c", "import encodings; print('stdlib-ok')"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "stdlib-ok");
    }
    #[test]
    fn upgraded_locks_and_partial_installations_require_setup() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let app = root.path().join("packaged");
        std::fs::create_dir_all(data.join("runtime/app")).unwrap();
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(
            app.join("runtime_manifest.json"),
            r#"{"requirementsSha256":"requirements","locks":{"E3":{"sha256":"new-lock"}}}"#,
        )
        .unwrap();
        let marker = data.join("runtime/runtime-ready.json");
        std::fs::write(
            &marker,
            r#"{"requirementsSha256":"requirements","profile":"E3","lockSha256":"old-lock"}"#,
        )
        .unwrap();
        assert!(!managed_ready(&data, &app));
        std::fs::write(
            &marker,
            r#"{"requirementsSha256":"requirements","profile":"E3","lockSha256":"new-lock"}"#,
        )
        .unwrap();
        assert!(!managed_ready(&data, &app));
        std::fs::write(data.join("runtime/app/desktop_worker.py"), "").unwrap();
        assert!(managed_ready(&data, &app));
    }
}
