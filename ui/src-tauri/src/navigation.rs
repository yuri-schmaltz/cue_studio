use reqwest::Url;

#[derive(Debug, PartialEq)]
pub enum Navigation {
    Internal,
    External,
    Denied,
}

pub fn classify(url: &Url, worker_port: Option<u16>, development: bool) -> Navigation {
    if url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.path() == "/desktop.html"
    {
        return Navigation::Internal;
    }
    if url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && worker_port.is_some()
        && url.port() == worker_port
    {
        return Navigation::Internal;
    }
    if development
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(3000)
        && url.path() == "/desktop.html"
    {
        return Navigation::Internal;
    }
    if matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
    {
        return Navigation::External;
    }
    Navigation::Denied
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_owned_worker_and_splash_stay_inside() {
        for (url, expected) in [
            ("tauri://localhost/desktop.html", Navigation::Internal),
            (
                "http://127.0.0.1:1234/__desktop/bootstrap/secret",
                Navigation::Internal,
            ),
            ("http://127.0.0.1:7860/", Navigation::Denied),
            ("https://example.org/help", Navigation::External),
            ("file:///etc/passwd", Navigation::Denied),
            ("javascript:alert(1)", Navigation::Denied),
            ("https://user:secret@example.org", Navigation::Denied),
        ] {
            assert_eq!(
                classify(&Url::parse(url).unwrap(), Some(1234), false),
                expected
            );
        }
    }
}
