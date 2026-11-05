use std::{
    fs,
    path::{Path, PathBuf},
};

/// Keep dialog history in desktop data, independent of the selected runtime.
pub fn load(data: &Path) -> Option<PathBuf> {
    let bytes = fs::read(data.join("last-folder.json")).ok()?;
    let path: PathBuf = serde_json::from_slice(&bytes).ok()?;
    path.is_dir().then_some(path)
}

pub fn remember(data: &Path, folder: &Path) {
    if !folder.is_dir() {
        return;
    }
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(data)?;
        fs::write(data.join("last-folder.json"), serde_json::to_vec(folder)?)?;
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("Unable to remember last folder: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_selection_and_ignores_missing_or_corrupt_history() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("preferences");
        let selected = root.path().join("my workspace");
        fs::create_dir(&selected).unwrap();
        assert_eq!(load(&data), None);
        remember(&data, &selected);
        assert_eq!(load(&data), Some(selected.clone()));
        fs::remove_dir(selected).unwrap();
        assert_eq!(load(&data), None);
        fs::write(data.join("last-folder.json"), b"invalid").unwrap();
        assert_eq!(load(&data), None);
    }
}
