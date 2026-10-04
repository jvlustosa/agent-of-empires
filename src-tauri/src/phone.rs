//! "Celular": the agents from the phone, over the home network. Off until turned on in the panel;
//! then the app serves a small page and a JSON API on one port, answers only private addresses
//! (home Wi-Fi, Tailscale), and every API call must carry the pairing token from the QR code.
//!
//! The token travels in the link's #fragment, which browsers never send: the page keeps it and
//! sends it as a Bearer header. Plain HTTP, so on a shared Wi-Fi only Tailscale keeps it private.

use crate::approval::{Approvals, Decision};
use crate::hosted::Hosted;
use crate::{projects, LatestSnapshot, TASK_MAX_CHARS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::CStr;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "phone.json";
const DEFAULT_PORT: u16 = 47380;
const TOKEN_BYTES: usize = 32;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HEAD_BYTES: u64 = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_CONNECTIONS: usize = 16;
// A wrong token waits a little before the answer: guessing stays slow even on the home network.
const WRONG_TOKEN_DELAY: Duration = Duration::from_millis(400);
// Bridges for containers and VMs: private addresses the phone can never reach.
const VIRTUAL_INTERFACES: [&str; 9] = ["docker", "br-", "veth", "virbr", "lxc", "podman", "cni", "vmnet", "vboxnet"];

const PAGE_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; \
connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PAGE_HTML: &str = include_str!("../../src/mobile/index.html");
const PAGE_JS: &str = include_str!("../../src/mobile/mobile.js");
const PAGE_CSS: &str = include_str!("../../src/mobile/mobile.css");
const KINDS_JS: &str = include_str!("../../src/js/kinds.js");
const FONT: &[u8] = include_bytes!("../../src/fonts/pixelify-sans-latin.woff2");

static STATE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once at startup with the app's config folder.
pub fn init(config_dir: &Path) {
    let _ = STATE_PATH.set(config_dir.join(STATE_FILE));
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PhoneConfig {
    is_on: bool,
    /// Pairing secret, hex; empty until first turned on. "Trocar o código" makes a new one.
    token: String,
    /// The port the phone's link points to; kept so the QR stays valid across restarts.
    port: u16,
}

impl PhoneConfig {
    fn load() -> Self {
        STATE_PATH
            .get()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// 0600: the token is a credential.
    fn save(&self) -> Result<(), String> {
        let path = STATE_PATH.get().ok_or("Configuração ainda não carregada")?;
        let text = serde_json::to_string_pretty(self).map_err(|err| err.to_string())?;
        let tmp = path.with_extension("tmp-agent-of-empires");
        let write = || -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
            file.write_all(text.as_bytes())?;
            fs::rename(&tmp, path)
        };
        write().map_err(|err| format!("Não consegui salvar o celular: {err}"))
    }
}

/// What the "Celular" panel shows. The links carry the token: they only go to the app's own window.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    is_on: bool,
    port: Option<u16>,
    links: Vec<Link>,
    last_seen_at: Option<i64>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Link {
    network: &'static str,
    address: String,
    url: String,
}

pub struct Phone {
    app: AppHandle,
    config: Mutex<PhoneConfig>,
    /// The port being served, None while off.
    serving: Mutex<Option<u16>>,
    /// Bumped on every stop, so a listener from before knows to quit.
    generation: AtomicU64,
    last_seen_at: AtomicI64,
    open_connections: AtomicUsize,
    error: Mutex<Option<String>>,
}

impl Phone {
    /// Picks up where the last run left: serving again if it was on.
    pub fn new(app: AppHandle) -> Arc<Self> {
        let config = PhoneConfig::load();
        let is_on = config.is_on;
        let phone = Arc::new(Self {
            app,
            config: Mutex::new(config),
            serving: Mutex::new(None),
            generation: AtomicU64::new(0),
            last_seen_at: AtomicI64::new(0),
            open_connections: AtomicUsize::new(0),
            error: Mutex::new(None),
        });
        if is_on {
            phone.start();
        }
        phone
    }

    fn status(&self) -> PhoneStatus {
        let (is_on, token) = self.config.lock().map(|c| (c.is_on, c.token.clone())).unwrap_or_default();
        let port = *self.serving.lock().unwrap();
        let links = match port {
            Some(port) => home_addresses()
                .into_iter()
                .map(|(network, ip)| Link { network, address: format!("{ip}:{port}"), url: format!("http://{ip}:{port}/#t={token}") })
                .collect(),
            None => Vec::new(),
        };
        let last_seen_at = Some(self.last_seen_at.load(Ordering::Relaxed)).filter(|&at| at > 0);
        PhoneStatus { is_on, port, links, last_seen_at, error: self.error.lock().ok().and_then(|e| e.clone()) }
    }

    fn start(self: &Arc<Self>) {
        let result = self.listen();
        if let Err(err) = &result {
            eprintln!("[phone] not serving: {err}");
        }
        *self.error.lock().unwrap() = result.err();
    }

    fn listen(self: &Arc<Self>) -> Result<(), String> {
        let mut config = self.config.lock().map_err(|_| "Estado indisponível".to_string())?;
        if config.token.is_empty() {
            config.token = new_token()?;
            config.save()?;
        }
        let wanted = if config.port == 0 { DEFAULT_PORT } else { config.port };
        // Port taken (another app, or a listener still closing): any free one, and the QR follows.
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, wanted))
            .or_else(|_| TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)))
            .map_err(|err| format!("Não consegui abrir uma porta: {err}"))?;
        let port = listener.local_addr().map_err(|err| err.to_string())?.port();
        if port != config.port {
            config.port = port;
            config.save()?;
        }
        *self.serving.lock().unwrap() = Some(port);
        let generation = self.generation.load(Ordering::SeqCst);
        let phone = self.clone();
        thread::spawn(move || phone.accept(listener, generation));
        Ok(())
    }

    fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(port) = self.serving.lock().unwrap().take() {
            // Wakes the blocking accept, which then sees the new generation and drops the port.
            let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_secs(1));
        }
    }

    fn accept(self: Arc<Self>, listener: TcpListener, generation: u64) {
        for stream in listener.incoming() {
            if self.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            let Ok(stream) = stream else {
                thread::sleep(Duration::from_millis(100)); // out of file descriptors: don't spin
                continue;
            };
            if !stream.peer_addr().is_ok_and(|peer| is_home_network(peer.ip())) {
                continue; // dropped unanswered
            }
            if self.open_connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                self.open_connections.fetch_sub(1, Ordering::SeqCst);
                continue;
            }
            let phone = self.clone();
            thread::spawn(move || {
                phone.serve(stream);
                phone.open_connections.fetch_sub(1, Ordering::SeqCst);
            });
        }
    }

    fn serve(&self, mut stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
        let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
        let response = match read_request(&stream) {
            Ok(request) => self.route(&request),
            Err(response) => response,
        };
        let _ = response.write_to(&mut stream);
    }

    fn route(&self, request: &Request) -> Response {
        let path = request.target.split('?').next().unwrap_or_default();
        let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
        match (request.method.as_str(), segments.as_slice()) {
            ("GET", [""]) => Response::page(PAGE_HTML, "text/html; charset=utf-8"),
            ("GET", ["mobile.js"]) => Response::page(PAGE_JS, "text/javascript; charset=utf-8"),
            ("GET", ["kinds.js"]) => Response::page(KINDS_JS, "text/javascript; charset=utf-8"),
            ("GET", ["mobile.css"]) => Response::page(PAGE_CSS, "text/css; charset=utf-8"),
            ("GET", ["fonts", "pixelify-sans-latin.woff2"]) => Response::bytes(200, "font/woff2", FONT.to_vec()),
            (_, ["api", ..]) => {
                if !self.is_paired(request) {
                    thread::sleep(WRONG_TOKEN_DELAY);
                    return Response::error(401, "Código do celular inválido: escaneie o QR de novo no painel Celular");
                }
                self.last_seen_at.store(now_ms(), Ordering::Relaxed);
                self.api(request, &segments[1..]).unwrap_or_else(|(status, message)| Response::error(status, &message))
            }
            ("GET", _) => Response::error(404, "Página não encontrada"),
            _ => Response::error(405, "Método não aceito"),
        }
    }

    fn is_paired(&self, request: &Request) -> bool {
        let Some(given) = request.authorization.as_deref().and_then(|value| value.strip_prefix("Bearer ")) else { return false };
        let config = self.config.lock().unwrap();
        config.is_on && !config.token.is_empty() && same_secret(given.trim().as_bytes(), config.token.as_bytes())
    }

    fn api(&self, request: &Request, route: &[&str]) -> Result<Response, (u16, String)> {
        match (request.method.as_str(), route) {
            ("GET", ["state"]) => Ok(Response::json(&self.state_json())),
            ("GET", ["projects"]) => {
                let projects: Vec<Value> = projects::list_projects().into_iter().map(|p| json!({ "name": p.name, "path": p.path })).collect();
                Ok(Response::json(&Value::Array(projects)))
            }
            ("POST", ["approvals", id]) => {
                let id: u64 = id.parse().map_err(|_| (404, "Pedido não encontrado".to_string()))?;
                let answer: ApprovalAnswer = parse_body(&request.body)?;
                if answer.decision == Decision::Ask {
                    return Err((400, "Do celular, só aprovar ou negar".into()));
                }
                let approvals = self.app.try_state::<Arc<Approvals>>().ok_or((503, "Aprovações indisponíveis".to_string()))?;
                if !approvals.resolve(id, answer.decision, answer.answers) {
                    return Err((409, "Esse pedido já foi respondido ou expirou".into()));
                }
                Ok(Response::json(&json!({ "ok": true })))
            }
            ("POST", ["agents", session_id, "reply"]) => {
                let reply: Reply = parse_body(&request.body)?;
                let text = checked_text(&reply.text, "Escreva a mensagem")?;
                self.hosted()?.send(session_id, text).map_err(|err| (409, err))?;
                Ok(Response::json(&json!({ "ok": true })))
            }
            ("POST", ["agents"]) => {
                let order: NewAgent = parse_body(&request.body)?;
                let task = checked_text(&order.task, "Escreva o que o agente deve fazer")?;
                // Only folders we listed ourselves, as for deploy_agent: the phone never names a path.
                let project = projects::list_projects()
                    .into_iter()
                    .find(|p| p.path == order.path)
                    .ok_or((400, "Esse projeto não está na lista".to_string()))?;
                self.hosted()?.spawn(Path::new(&project.path), task, None).map_err(|err| (500, err))?;
                Ok(Response::json(&json!({ "message": format!("Agente trabalhando em {}", project.name) })))
            }
            _ => Err((404, "Rota não encontrada".into())),
        }
    }

    fn hosted(&self) -> Result<Arc<Hosted>, (u16, String)> {
        self.app.try_state::<Arc<Hosted>>().map(|h| h.inner().clone()).ok_or((503, "Agentes do app indisponíveis".into()))
    }

    /// Only what the phone shows: no pids, folders or edited files.
    fn state_json(&self) -> Value {
        let hosted_ids = self.app.try_state::<Arc<Hosted>>().map(|h| h.session_ids()).unwrap_or_default();
        let agents: Vec<Value> = self
            .app
            .try_state::<LatestSnapshot>()
            .and_then(|latest| latest.0.lock().ok().and_then(|s| s.clone()))
            .map(|snapshot| snapshot.agents)
            .unwrap_or_default()
            .into_iter()
            .filter(|agent| !(agent.entrypoint.starts_with("sdk") && agent.project.to_lowercase().contains("observer")))
            .map(|agent| {
                json!({
                    "id": agent.id,
                    "project": agent.project,
                    "title": agent.title,
                    "status": agent.status,
                    "activity": agent.activity,
                    "lastPrompt": agent.last_prompt,
                    "lastReply": agent.last_reply,
                    "isHosted": hosted_ids.contains(&agent.id),
                    "host": agent.editor,
                })
            })
            .collect();
        let approvals = self.app.try_state::<Arc<Approvals>>().map(|a| a.list()).unwrap_or_default();
        json!({ "agents": agents, "approvals": approvals, "now": now_ms() })
    }
}

#[derive(Deserialize)]
struct ApprovalAnswer {
    decision: Decision,
    answers: Option<Value>,
}

#[derive(Deserialize)]
struct Reply {
    text: String,
}

#[derive(Deserialize)]
struct NewAgent {
    path: String,
    task: String,
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, (u16, String)> {
    serde_json::from_slice(body).map_err(|_| (400, "Pedido em formato inválido".to_string()))
}

fn checked_text<'a>(text: &'a str, empty_message: &str) -> Result<&'a str, (u16, String)> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > TASK_MAX_CHARS {
        return Err((400, format!("{empty_message} (até {TASK_MAX_CHARS} caracteres)")));
    }
    Ok(text)
}

struct Request {
    method: String,
    target: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

/// One request per connection (the answer closes it): request line, headers, a JSON body.
fn read_request(stream: &TcpStream) -> Result<Request, Response> {
    let bad = || Response::error(400, "Pedido inválido");
    let mut reader = BufReader::new(stream.take(MAX_HEAD_BYTES + MAX_BODY_BYTES as u64));
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|_| bad())?;
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else { return Err(bad()) };
    let (method, target) = (method.to_string(), target.to_string());
    let mut authorization = None;
    let mut content_length = 0usize;
    let mut head_bytes = line.len();
    loop {
        line.clear();
        let read = reader.read_line(&mut line).map_err(|_| bad())?;
        head_bytes += read;
        if read == 0 || head_bytes as u64 > MAX_HEAD_BYTES {
            return Err(bad());
        }
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        let Some((name, value)) = header.split_once(':') else { continue };
        match name.trim().to_ascii_lowercase().as_str() {
            "authorization" => authorization = Some(value.trim().to_string()),
            "content-length" => content_length = value.trim().parse().map_err(|_| bad())?,
            _ => {}
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err(Response::error(413, "Pedido grande demais"));
    }
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body).map_err(|_| bad())?;
    Ok(Request { method, target, authorization, body })
}

struct Response {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

impl Response {
    fn page(text: &str, content_type: &'static str) -> Self {
        Self::bytes(200, content_type, text.as_bytes().to_vec())
    }

    fn bytes(status: u16, content_type: &'static str, body: Vec<u8>) -> Self {
        Self { status, content_type, body }
    }

    fn json(value: &Value) -> Self {
        Self::bytes(200, "application/json", value.to_string().into_bytes())
    }

    fn error(status: u16, message: &str) -> Self {
        Self::bytes(status, "application/json", json!({ "error": message }).to_string().into_bytes())
    }

    fn write_to(&self, stream: &mut TcpStream) -> std::io::Result<()> {
        let reason = match self.status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            405 => "Method Not Allowed",
            409 => "Conflict",
            413 => "Payload Too Large",
            503 => "Service Unavailable",
            _ => "Internal Server Error",
        };
        let head = format!(
            "HTTP/1.1 {} {reason}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\
             X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {PAGE_CSP}\r\n\r\n",
            self.status,
            self.content_type,
            self.body.len()
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(&self.body)?;
        stream.flush()
    }
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; TOKEN_BYTES];
    File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .map_err(|err| format!("Não consegui gerar o código do celular: {err}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Compares in constant time, so the answer's timing says nothing about the token.
fn same_secret(given: &[u8], expected: &[u8]) -> bool {
    given.len() == expected.len() && given.iter().zip(expected).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn is_tailscale(ip: Ipv4Addr) -> bool {
    let [first, second, ..] = ip.octets();
    first == 100 && (second & 0xc0) == 64 // 100.64.0.0/10
}

fn is_home_network(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || is_tailscale(ip),
        IpAddr::V6(_) => false, // the listener is IPv4 only
    }
}

/// This machine's addresses a phone can reach: Wi-Fi or cable first, then Tailscale.
fn home_addresses() -> Vec<(&'static str, Ipv4Addr)> {
    let mut list: Vec<(&'static str, Ipv4Addr)> =
        interface_addresses().into_iter().filter_map(|(name, ip)| network_label(&name, ip).map(|label| (label, ip))).collect();
    list.sort_by_key(|(label, _)| *label == "Tailscale");
    list
}

fn network_label(interface: &str, ip: Ipv4Addr) -> Option<&'static str> {
    if is_tailscale(ip) {
        return Some("Tailscale");
    }
    if !ip.is_private() || VIRTUAL_INTERFACES.iter().any(|prefix| interface.starts_with(prefix)) {
        return None;
    }
    Some(if interface.starts_with("wl") {
        "Wi-Fi"
    } else if interface.starts_with("en") || interface.starts_with("eth") {
        "Cabo"
    } else {
        "Rede local"
    })
}

fn interface_addresses() -> Vec<(String, Ipv4Addr)> {
    let mut list = Vec::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs hands us a list we only read, then free once with freeifaddrs.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return list;
    }
    let mut cursor = head;
    while !cursor.is_null() {
        let entry = unsafe { &*cursor };
        cursor = entry.ifa_next;
        if entry.ifa_addr.is_null() || i32::from(unsafe { (*entry.ifa_addr).sa_family }) != libc::AF_INET {
            continue;
        }
        let address = unsafe { &*(entry.ifa_addr as *const libc::sockaddr_in) };
        let name = unsafe { CStr::from_ptr(entry.ifa_name) }.to_string_lossy().into_owned();
        list.push((name, Ipv4Addr::from(u32::from_be(address.sin_addr.s_addr))));
    }
    unsafe { libc::freeifaddrs(head) };
    list
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn get_phone(phone: tauri::State<Arc<Phone>>) -> PhoneStatus {
    phone.status()
}

/// Turns the phone page on or off; off drops the port at once, and the paired phone with it.
#[tauri::command]
pub fn set_phone(is_on: bool, phone: tauri::State<Arc<Phone>>) -> Result<PhoneStatus, String> {
    {
        let mut config = phone.config.lock().map_err(|_| "Estado indisponível".to_string())?;
        config.is_on = is_on;
        config.save()?;
    }
    phone.stop();
    if is_on {
        phone.start();
    } else {
        *phone.error.lock().unwrap() = None;
    }
    Ok(phone.status())
}

/// A new pairing code: the phone paired before stops working until it scans the new QR.
#[tauri::command]
pub fn reset_phone_token(phone: tauri::State<Arc<Phone>>) -> Result<PhoneStatus, String> {
    let mut config = phone.config.lock().map_err(|_| "Estado indisponível".to_string())?;
    config.token = new_token()?;
    config.save()?;
    drop(config);
    phone.last_seen_at.store(0, Ordering::Relaxed);
    Ok(phone.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_home_addresses_get_an_answer() {
        assert!(is_home_network("192.168.0.12".parse().unwrap()));
        assert!(is_home_network("10.0.0.5".parse().unwrap()));
        assert!(is_home_network("172.20.1.1".parse().unwrap()));
        assert!(is_home_network("100.101.102.103".parse().unwrap()));
        assert!(is_home_network("127.0.0.1".parse().unwrap()));
        assert!(!is_home_network("100.128.0.1".parse().unwrap())); // past 100.64/10
        assert!(!is_home_network("8.8.8.8".parse().unwrap()));
        assert!(!is_home_network("::1".parse().unwrap()));
    }

    #[test]
    fn container_bridges_are_not_offered_to_the_phone() {
        let ip: Ipv4Addr = "172.17.0.1".parse().unwrap();
        assert_eq!(network_label("docker0", ip), None);
        assert_eq!(network_label("br-1a2b", ip), None);
        assert_eq!(network_label("wlan0", "192.168.0.12".parse().unwrap()), Some("Wi-Fi"));
        assert_eq!(network_label("enp3s0", "192.168.0.13".parse().unwrap()), Some("Cabo"));
        assert_eq!(network_label("tailscale0", "100.90.1.2".parse().unwrap()), Some("Tailscale"));
        assert_eq!(network_label("wlan0", "8.8.8.8".parse().unwrap()), None);
    }

    #[test]
    fn the_token_must_match_exactly() {
        assert!(same_secret(b"abc123", b"abc123"));
        assert!(!same_secret(b"abc124", b"abc123"));
        assert!(!same_secret(b"abc12", b"abc123"));
        assert!(!same_secret(b"", b"abc123"));
    }

    fn parse(raw: &[u8]) -> Result<Request, Response> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client.write_all(raw).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let (server, _) = listener.accept().unwrap();
        server.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
        read_request(&server)
    }

    #[test]
    fn reads_the_token_and_the_body() {
        let raw = b"POST /api/agents/abc/reply HTTP/1.1\r\nHost: 192.168.0.12\r\nauthorization: Bearer f00d\r\nContent-Length: 13\r\n\r\n{\"text\":\"oi\"}";
        let Ok(request) = parse(raw) else { panic!("valid request refused") };
        assert_eq!((request.method.as_str(), request.target.as_str()), ("POST", "/api/agents/abc/reply"));
        assert_eq!(request.authorization.as_deref(), Some("Bearer f00d"));
        assert_eq!(request.body, b"{\"text\":\"oi\"}");
    }

    #[test]
    fn oversized_or_cut_requests_are_refused() {
        let Err(too_big) = parse(b"POST /api/agents HTTP/1.1\r\nContent-Length: 999999\r\n\r\n") else { panic!("huge body accepted") };
        assert_eq!(too_big.status, 413);
        let Err(cut) = parse(b"GET /api/state HTTP/1.1\r\nAuthorization: Bearer f00d\r\n") else { panic!("headers without an end accepted") };
        assert_eq!(cut.status, 400);
        let Err(short_body) = parse(b"POST /api/agents HTTP/1.1\r\nContent-Length: 50\r\n\r\n{}") else { panic!("short body accepted") };
        assert_eq!(short_body.status, 400);
    }

    #[test]
    fn tokens_are_long_and_fresh() {
        let (first, second) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(first.len(), TOKEN_BYTES * 2);
        assert_ne!(first, second);
    }
}
