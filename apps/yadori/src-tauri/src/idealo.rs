use reqwest::{header::HeaderName, Method, Url};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, watch},
};

const MAX_BODY: usize = 4 * 1024 * 1024;
const MAX_CREDENTIALS: usize = 64 * 1024;
const AUTH_TIMEOUT: Duration = Duration::from_secs(180);
const AUTH_CALLBACK_PORT: u16 = 6274;

pub struct IdealoNativeState {
    client: reqwest::Client,
    flows: Mutex<HashMap<String, AuthFlow>>,
}

impl IdealoNativeState {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .build()
            .map_err(|_| "Could not initialize the Idealo connection")?;
        Ok(Self {
            client,
            flows: Mutex::new(HashMap::new()),
        })
    }
}

struct AuthFlow {
    result: watch::Receiver<Option<IdealoAuthResult>>,
    cancel: oneshot::Sender<()>,
}

#[derive(Deserialize)]
pub struct IdealoRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdealoResponse {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdealoAuthFlow {
    flow_id: String,
    redirect_url: String,
    state: String,
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum IdealoAuthResult {
    Code { code: String },
    Error { error: String },
}

#[tauri::command]
pub async fn request_idealo(
    state: State<'_, IdealoNativeState>,
    request: IdealoRequest,
) -> Result<IdealoResponse, String> {
    let (url, method) = validate_request(&request)?;
    let mut builder = state.client.request(method, url);
    for (name, value) in request.headers {
        let name =
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| "Invalid Idealo request header")?;
        let value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| "Invalid Idealo request header")?;
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| "Idealo could not be reached. Try again.")?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err("Idealo returned a response larger than 4 MB".into());
    }
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            if name == "set-cookie" {
                return None;
            }
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The Idealo response could not be read")?
    {
        if body.len() + chunk.len() > MAX_BODY {
            return Err("Idealo returned a response larger than 4 MB".into());
        }
        body.extend_from_slice(&chunk);
    }
    let body =
        String::from_utf8(body).map_err(|_| "Idealo returned an unsupported response encoding")?;
    Ok(IdealoResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
}

#[tauri::command]
pub async fn read_idealo_credentials(app: AppHandle) -> Result<Option<String>, String> {
    let service = credential_service(&app.config().identifier);
    tauri::async_runtime::spawn_blocking(move || match credential_entry(&service)?.get_password() {
        Ok(content) => {
            validate_credential_blob(&content)?;
            Ok(Some(content))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(
            "Could not read Idealo credentials from the operating system credential store".into(),
        ),
    })
    .await
    .map_err(|_| "Credential storage was interrupted".to_string())?
}

#[tauri::command]
pub async fn save_idealo_credentials(app: AppHandle, content: String) -> Result<(), String> {
    validate_credential_blob(&content)?;
    let service = credential_service(&app.config().identifier);
    tauri::async_runtime::spawn_blocking(move || {
        credential_entry(&service)?
            .set_password(&content)
            .map_err(|_| {
                "Could not save Idealo credentials to the operating system credential store".into()
            })
    })
    .await
    .map_err(|_| "Credential storage was interrupted".to_string())?
}

#[tauri::command]
pub async fn clear_idealo_credentials(app: AppHandle) -> Result<(), String> {
    let service = credential_service(&app.config().identifier);
    tauri::async_runtime::spawn_blocking(move || {
        match credential_entry(&service)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(
                "Could not remove Idealo credentials from the operating system credential store"
                    .into(),
            ),
        }
    })
    .await
    .map_err(|_| "Credential storage was interrupted".to_string())?
}

#[tauri::command]
pub async fn start_idealo_auth(
    state: State<'_, IdealoNativeState>,
) -> Result<IdealoAuthFlow, String> {
    let previous = {
        let mut flows = state
            .flows
            .lock()
            .map_err(|_| "Idealo authorization is busy")?;
        flows.drain().map(|(_, flow)| flow).collect::<Vec<_>>()
    };
    for flow in previous {
        cancel_flow(flow).await;
    }
    // Idealo's current registration policy permits this exact local callback URI.
    let listener = TcpListener::bind(("127.0.0.1", AUTH_CALLBACK_PORT)).await
        .map_err(|_| "Idealo callback port 6274 is unavailable. Close the application using that port and try again.")?;
    let ipv6_listener = match TcpListener::bind(("::1", AUTH_CALLBACK_PORT)).await {
        Ok(listener) => Some(listener),
        Err(error) if matches!(error.kind(), std::io::ErrorKind::AddrNotAvailable | std::io::ErrorKind::Unsupported) => None,
        Err(_) => return Err("Idealo callback port 6274 is unavailable on IPv6. Close the application using that port and try again.".into()),
    };
    let port = AUTH_CALLBACK_PORT;
    let flow_id = random_hex(16)?;
    let oauth_state = random_hex(32)?;
    let (result_tx, result_rx) = watch::channel(None);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut flows = state
            .flows
            .lock()
            .map_err(|_| "Idealo authorization is busy")?;
        flows.insert(
            flow_id.clone(),
            AuthFlow {
                result: result_rx,
                cancel: cancel_tx,
            },
        );
    }
    spawn_callback(
        listener,
        ipv6_listener,
        oauth_state.clone(),
        port,
        result_tx,
        cancel_rx,
    );
    Ok(IdealoAuthFlow {
        flow_id,
        redirect_url: callback_redirect_url(),
        state: oauth_state,
    })
}

#[tauri::command]
pub async fn wait_idealo_auth(
    state: State<'_, IdealoNativeState>,
    flow_id: String,
) -> Result<IdealoAuthResult, String> {
    let mut receiver = {
        let flows = state
            .flows
            .lock()
            .map_err(|_| "Idealo authorization is busy")?;
        let Some(flow) = flows.get(&flow_id) else {
            return Ok(auth_error(
                "This Idealo authorization flow is no longer active.",
            ));
        };
        flow.result.clone()
    };
    let result = loop {
        if let Some(result) = receiver.borrow().clone() {
            break result;
        }
        if receiver.changed().await.is_err() {
            break auth_error("Idealo authorization ended before a callback arrived.");
        }
    };
    state
        .flows
        .lock()
        .map_err(|_| "Idealo authorization is busy")?
        .remove(&flow_id);
    Ok(result)
}

#[tauri::command]
pub async fn cancel_idealo_auth(
    state: State<'_, IdealoNativeState>,
    flow_id: String,
) -> Result<(), String> {
    let flow = state
        .flows
        .lock()
        .map_err(|_| "Idealo authorization is busy")?
        .remove(&flow_id);
    if let Some(flow) = flow {
        cancel_flow(flow).await;
    }
    Ok(())
}

async fn cancel_flow(flow: AuthFlow) {
    let AuthFlow { mut result, cancel } = flow;
    let _ = cancel.send(());
    if result.borrow().is_none() {
        let _ = tokio::time::timeout(Duration::from_secs(2), result.changed()).await;
    }
}

fn callback_redirect_url() -> String {
    format!("http://localhost:{AUTH_CALLBACK_PORT}/callback")
}

fn validate_request(request: &IdealoRequest) -> Result<(Url, Method), String> {
    let url = Url::parse(&request.url).map_err(|_| "Invalid Idealo URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("mcp.idealo.com")
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err("Only official Idealo MCP and OAuth endpoints are allowed".into());
    }
    let method = match request.method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "DELETE" => Method::DELETE,
        _ => return Err("Only GET, POST and DELETE are allowed for Idealo requests".into()),
    };
    let valid = match url.path() {
        "/mcp" => true,
        "/oauth2/token" | "/oauth2/register" => method == Method::POST,
        "/.well-known/oauth-protected-resource"
        | "/.well-known/oauth-protected-resource/mcp"
        | "/.well-known/oauth-authorization-server"
        | "/.well-known/openid-configuration" => method == Method::GET,
        _ => false,
    };
    if !valid {
        return Err("This Idealo endpoint or method is not allowed".into());
    }
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_BODY)
    {
        return Err("Idealo request exceeds the 4 MB limit".into());
    }
    if method == Method::GET && request.body.as_ref().is_some_and(|body| !body.is_empty()) {
        return Err("GET requests cannot contain a body".into());
    }
    if request.headers.len() > 32 {
        return Err("Too many Idealo request headers".into());
    }
    for (name, value) in &request.headers {
        let allowed = matches!(
            name.to_ascii_lowercase().as_str(),
            "accept"
                | "content-type"
                | "authorization"
                | "mcp-session-id"
                | "mcp-protocol-version"
                | "last-event-id"
                | "cache-control"
        );
        if !allowed || value.len() > 16 * 1024 {
            return Err("An Idealo request header is not allowed".into());
        }
    }
    Ok((url, method))
}

fn validate_credential_blob(content: &str) -> Result<(), String> {
    if content.len() > MAX_CREDENTIALS {
        return Err("Idealo credential data exceeds the secure storage limit".into());
    }
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|_| "Idealo credential data must be a JSON object")?;
    if !value.is_object() {
        return Err("Idealo credential data must be a JSON object".into());
    }
    Ok(())
}

fn credential_service(identifier: &str) -> String {
    format!("{identifier}.idealo")
}
fn credential_entry(service: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, "oauth-v1")
        .map_err(|_| "The operating system credential store is unavailable".to_string())
}
fn auth_error(error: &str) -> IdealoAuthResult {
    IdealoAuthResult::Error {
        error: error.to_string(),
    }
}
fn random_hex(bytes: usize) -> Result<String, String> {
    let mut data = vec![0u8; bytes];
    getrandom::fill(&mut data).map_err(|_| "Could not generate secure authorization state")?;
    Ok(data.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn spawn_callback(
    listener: TcpListener,
    ipv6_listener: Option<TcpListener>,
    expected_state: String,
    port: u16,
    result_tx: watch::Sender<Option<IdealoAuthResult>>,
    cancel_rx: oneshot::Receiver<()>,
) {
    tauri::async_runtime::spawn(async move {
        let mut callback = Box::pin(callback_listener(
            listener,
            ipv6_listener,
            &expected_state,
            port,
        ));
        let result = tokio::select! {
            result = &mut callback => result,
            _ = cancel_rx => auth_error("Idealo authorization was cancelled."),
            _ = tokio::time::sleep(AUTH_TIMEOUT) => auth_error("Idealo authorization timed out. Connect again to retry."),
        };
        drop(callback);
        result_tx.send_replace(Some(result));
    });
}

async fn callback_listener(
    listener: TcpListener,
    ipv6_listener: Option<TcpListener>,
    expected_state: &str,
    port: u16,
) -> IdealoAuthResult {
    loop {
        let accepted = match &ipv6_listener {
            Some(ipv6) => tokio::select! {
                result = listener.accept() => result,
                result = ipv6.accept() => result,
            },
            None => listener.accept().await,
        };
        let Ok((mut stream, _)) = accepted else {
            return auth_error("The local authorization callback stopped.");
        };
        let request =
            match tokio::time::timeout(Duration::from_secs(3), read_callback_request(&mut stream))
                .await
            {
                Ok(Ok(request)) => request,
                _ => continue,
            };
        let result = parse_callback(&request, expected_state, port);
        let (status, message) = match &result {
            Some(IdealoAuthResult::Code { .. }) => (
                "200 OK",
                "Idealo authorization received. Return to Yadori; you can close this tab.",
            ),
            Some(IdealoAuthResult::Error { .. }) => (
                "200 OK",
                "Idealo authorization was not completed. Return to Yadori to retry.",
            ),
            None => (
                "400 Bad Request",
                "This authorization callback was not accepted.",
            ),
        };
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{message}", message.len());
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(result) = result {
            return result;
        }
    }
}

async fn read_callback_request(stream: &mut TcpStream) -> Result<String, ()> {
    let mut data = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let count = stream.read(&mut buffer).await.map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        data.extend_from_slice(&buffer[..count]);
        if data.len() > 8192 {
            return Err(());
        }
        if data.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(data).map_err(|_| ())
}

fn parse_callback(request: &str, expected_state: &str, port: u16) -> Option<IdealoAuthResult> {
    let mut lines = request.split("\r\n");
    let first = lines.next()?;
    let parts: Vec<_> = first.split_whitespace().collect();
    if parts.len() != 3
        || parts[0] != "GET"
        || !parts[1].starts_with('/')
        || parts[1].starts_with("//")
    {
        return None;
    }
    let expected_host = format!("127.0.0.1:{port}");
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .collect();
    if hosts.len() != 1
        || ![
            expected_host.clone(),
            format!("localhost:{port}"),
            format!("[::1]:{port}"),
        ]
        .contains(&hosts[0].1.trim().to_string())
    {
        return None;
    }
    let url = Url::parse(&format!("http://{expected_host}{}", parts[1])).ok()?;
    if url.path() != "/callback" || url.fragment().is_some() {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(key, _)| key == "state").collect();
    if states.len() != 1 || !same_state(&states[0].1, expected_state) {
        return None;
    }
    let errors: Vec<_> = pairs.iter().filter(|(key, _)| key == "error").collect();
    let codes: Vec<_> = pairs.iter().filter(|(key, _)| key == "code").collect();
    if !errors.is_empty() {
        if errors.len() != 1 || !codes.is_empty() {
            return None;
        }
        return Some(auth_error(
            "Idealo authorization was declined or could not be completed.",
        ));
    }
    if codes.len() != 1 || codes[0].1.is_empty() || codes[0].1.len() > 4096 {
        return None;
    }
    Some(IdealoAuthResult::Code {
        code: codes[0].1.to_string(),
    })
}

fn same_state(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(url: &str, method: &str) -> IdealoRequest {
        IdealoRequest {
            url: url.into(),
            method: method.into(),
            headers: HashMap::new(),
            body: None,
        }
    }
    fn callback(path: &str, host: &str) -> String {
        format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n")
    }

    #[test]
    fn official_endpoints_have_narrow_method_and_origin_permissions() {
        assert!(validate_request(&request("https://mcp.idealo.com/mcp", "POST")).is_ok());
        assert!(validate_request(&request("https://mcp.idealo.com/oauth2/token", "POST")).is_ok());
        assert!(validate_request(&request(
            "https://mcp.idealo.com/.well-known/oauth-authorization-server",
            "GET"
        ))
        .is_ok());
        for url in [
            "http://mcp.idealo.com/mcp",
            "https://mcp.idealo.com.evil.example/mcp",
            "https://mcp.idealo.com@evil.example/mcp",
            "https://127.0.0.1/mcp",
            "https://mcp.idealo.com:444/mcp",
            "https://mcp.idealo.com/arbitrary",
            "https://mcp.idealo.com/mcp?target=anything",
        ] {
            assert!(validate_request(&request(url, "POST")).is_err());
        }
        assert!(
            validate_request(&request("https://mcp.idealo.com/oauth2/token", "DELETE")).is_err()
        );
        assert!(validate_request(&request("https://mcp.idealo.com/mcp", "PUT")).is_err());
        assert!(validate_request(&request(
            "https://mcp.idealo.com/.well-known/oauth-authorization-server",
            "POST"
        ))
        .is_err());
    }

    #[test]
    fn body_and_header_guards_prevent_generic_proxy_usage() {
        let mut value = request("https://mcp.idealo.com/mcp", "POST");
        value.body = Some("x".repeat(MAX_BODY + 1));
        assert!(validate_request(&value).is_err());
        value.body = None;
        value.headers.insert("Host".into(), "other.example".into());
        assert!(validate_request(&value).is_err());
        value.headers.clear();
        value
            .headers
            .insert("Authorization".into(), "Bearer synthetic-test-value".into());
        value
            .headers
            .insert("MCP-Protocol-Version".into(), "2025-11-25".into());
        assert!(validate_request(&value).is_ok());
    }

    #[test]
    fn callback_requires_the_exact_state_host_and_path() {
        let valid = callback("/callback?state=expected&code=synthetic", "127.0.0.1:12345");
        assert!(matches!(
            parse_callback(&valid, "expected", 12345),
            Some(IdealoAuthResult::Code { .. })
        ));
        for path in [
            "/callback?state=wrong&code=x",
            "/callback?state=expected&state=other&code=x",
            "/callback?state=expected&code=a&code=b",
            "/callback?state=expected",
            "/other?state=expected&code=x",
            "//evil.example/callback?state=expected&code=x",
        ] {
            assert!(
                parse_callback(&callback(path, "127.0.0.1:12345"), "expected", 12345).is_none()
            );
        }
        assert!(parse_callback(
            &callback("/callback?state=expected&code=x", "evil.example"),
            "expected",
            12345
        )
        .is_none());
        assert!(matches!(
            parse_callback(
                &callback(
                    "/callback?state=expected&error=access_denied",
                    "127.0.0.1:12345"
                ),
                "expected",
                12345
            ),
            Some(IdealoAuthResult::Error { .. })
        ));
    }

    #[test]
    fn secure_state_has_enough_entropy_and_distinct_values() {
        let left = random_hex(32).unwrap();
        let right = random_hex(32).unwrap();
        assert_eq!(left.len(), 64);
        assert_ne!(left, right);
        assert!(same_state(&left, &left));
        assert!(!same_state(&left, &right));
    }

    #[test]
    fn credentials_are_json_bundles_scoped_to_the_application() {
        assert!(validate_credential_blob(
            r#"{"tokens":{"access_token":"synthetic"},"codeVerifier":"synthetic"}"#
        )
        .is_ok());
        assert!(validate_credential_blob("not json").is_err());
        assert!(validate_credential_blob("[]").is_err());
        assert!(validate_credential_blob(&" ".repeat(MAX_CREDENTIALS + 1)).is_err());
        assert_ne!(
            credential_service("group.builder.yadori.next.dev"),
            credential_service("group.builder.yadori.dev")
        );
    }

    static LISTENER_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test(flavor = "current_thread")]
    async fn loopback_callback_rejects_an_unrelated_request_then_accepts_the_valid_code() {
        let _guard = LISTENER_TEST_LOCK.lock().await;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task =
            tokio::spawn(
                async move { callback_listener(listener, None, "expected-state", port).await },
            );
        let mut unrelated = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        unrelated
            .write_all(
                callback(
                    "/callback?state=wrong&code=synthetic",
                    &format!("127.0.0.1:{port}"),
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut response = String::new();
        tokio::time::timeout(
            Duration::from_secs(2),
            unrelated.read_to_string(&mut response),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(response.starts_with("HTTP/1.1 400"));
        let mut valid = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        valid
            .write_all(
                callback(
                    "/callback?state=expected-state&code=synthetic",
                    &format!("127.0.0.1:{port}"),
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        response.clear();
        tokio::time::timeout(Duration::from_secs(2), valid.read_to_string(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(!response.contains("synthetic"));
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(result, IdealoAuthResult::Code { code } if code == "synthetic"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancelling_authorization_releases_the_loopback_listener() {
        let _guard = LISTENER_TEST_LOCK.lock().await;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (result_tx, mut result_rx) = watch::channel(None);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        spawn_callback(
            listener,
            None,
            "synthetic-state".into(),
            port,
            result_tx,
            cancel_rx,
        );
        cancel_tx.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), result_rx.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            *result_rx.borrow(),
            Some(IdealoAuthResult::Error { .. })
        ));
        // A new listener can own the port only after the cancelled one has been dropped.
        let replacement = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match TcpListener::bind(("127.0.0.1", port)).await {
                    Ok(listener) => break listener,
                    Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                        tokio::time::sleep(Duration::from_millis(5)).await
                    }
                    Err(error) => panic!("Cannot rebind test listener: {error}"),
                }
            }
        })
        .await
        .expect("Cancelled listener must release its port");
        drop(replacement);
    }

    #[test]
    fn redirect_uses_the_exact_provider_allowed_localhost_callback() {
        assert_eq!(callback_redirect_url(), "http://localhost:6274/callback");
        let request = callback("/callback?state=expected&code=synthetic", "localhost:6274");
        assert!(matches!(
            parse_callback(&request, "expected", 6274),
            Some(IdealoAuthResult::Code { .. })
        ));
        assert!(parse_callback(
            &callback(
                "/callback?state=expected&code=synthetic",
                "localhost.evil.example:6274"
            ),
            "expected",
            6274
        )
        .is_none());
    }
}
