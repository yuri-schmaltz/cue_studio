//! Persist HTML file-input selections without granting the HTTP UI native IPC.
#[cfg(target_os = "linux")]
pub fn install(window: &tauri::WebviewWindow, data: std::path::PathBuf) -> tauri::Result<()> {
    window.with_webview(move |webview| connect(&webview.inner(), data))
}

#[cfg(target_os = "linux")]
pub fn connect(view: &webkit2gtk::WebView, data: std::path::PathBuf) {
    use gtk::prelude::*;
    use webkit2gtk::{FileChooserRequestExt, WebViewExt};
    let active = std::rc::Rc::new(std::cell::RefCell::new(None::<gtk::FileChooserNative>));
    view.connect_run_file_chooser(move |view, request| {
        if active.borrow().is_some() {
            request.cancel();
            return true;
        }
        let parent = view
            .toplevel()
            .and_then(|widget| widget.downcast::<gtk::Window>().ok());
        let chooser = gtk::FileChooserNative::new(
            Some("Select files"),
            parent.as_ref(),
            gtk::FileChooserAction::Open,
            Some("Open"),
            Some("Cancel"),
        );
        chooser.set_select_multiple(request.selects_multiple());
        if let Some(filter) = request.mime_types_filter() {
            chooser.add_filter(filter);
        }
        if let Some(folder) = crate::folder_history::load(&data) {
            chooser.set_current_folder(folder);
        }
        let request = request.clone();
        let data = data.clone();
        let pending = std::rc::Rc::downgrade(&active);
        chooser.connect_response(move |chooser, response| {
            if response == gtk::ResponseType::Accept {
                let files = chooser.filenames();
                if let Some(folder) = files.first().and_then(|file| file.parent()) {
                    crate::folder_history::remember(&data, folder);
                }
                let names: Vec<_> = files
                    .iter()
                    .map(|file| file.to_string_lossy().into_owned())
                    .collect();
                let names: Vec<_> = names.iter().map(String::as_str).collect();
                request.select_files(&names);
            } else {
                request.cancel();
            }
            chooser.destroy();
            if let Some(active) = pending.upgrade() {
                active.borrow_mut().take();
            }
        });
        active.borrow_mut().replace(chooser.clone());
        chooser.show();
        true
    });
}

#[cfg(not(target_os = "linux"))]
pub fn install(_window: &tauri::WebviewWindow, _data: std::path::PathBuf) -> tauri::Result<()> {
    Ok(())
}
