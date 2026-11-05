//! Runs the production file-input handler with a tiny GTK/WebKit page.
//! Fixture data is supplied by the smoke runner, never user project data.
#[path = "../src/file_dialog.rs"]
mod file_dialog;
#[path = "../src/folder_history.rs"]
mod folder_history;

fn main() {
    use gtk::prelude::*;
    use webkit2gtk::WebViewExt;
    gtk::init().expect("GTK display");
    let folder = std::env::args_os().nth(1).expect("isolated data directory");
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Cue attachment fixture");
    window.set_default_size(700, 400);
    let view = webkit2gtk::WebView::new();
    file_dialog::connect(&view, folder.into());
    let weak = window.downgrade();
    view.connect_title_notify(move |view| {
        if let (Some(window), Some(title)) = (weak.upgrade(), view.title()) {
            window.set_title(&title);
        }
    });
    view.load_html(r#"<!doctype html><title>Cue attachment fixture</title><button autofocus onclick="document.getElementById('attachment').click()">Choose files</button><input id="attachment" hidden type="file" accept="image/*" multiple onchange="document.title='Selected: '+Array.from(this.files).map(f=>f.name).join(',')">"#, None);
    window.add(&view);
    window.connect_destroy(|_| gtk::main_quit());
    window.show_all();
    gtk::main();
}
