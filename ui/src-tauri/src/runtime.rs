use std::path::Path;

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

#[cfg(test)]
mod tests {
    use super::*;
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
