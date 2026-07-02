#include "signaling/LocalSignalingServer.h"

#include "app/RoomBootstrap.h"
#include "protocol/Protocol.h"
#include "signaling/JsonUtil.h"
#include "util/Logger.h"
#include "util/NetUtil.h"

#include "mongoose.h"

#include <atomic>
#include <filesystem>
#include <mutex>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>

namespace audiostream {
namespace {

struct ReceiverConnection {
  std::string receiverId;
  std::string joinToken;
  std::string nickname;
  std::string clientId;
};

std::string RandomHex(const int byteCount) {
  static thread_local std::mt19937 rng{std::random_device{}()};
  std::uniform_int_distribution<int> dist(0, 15);
  const char* hex = "0123456789abcdef";
  std::string out;
  out.reserve(static_cast<size_t>(byteCount * 2));
  for (int i = 0; i < byteCount * 2; ++i) {
    out.push_back(hex[dist(rng)]);
  }
  return out;
}

std::string BuildReceiverUrl(const std::string& ip, const int port, const std::string& code) {
  std::ostringstream url;
  url << "http://" << ip << ':' << port << "/receiver?code=" << code;
  return url.str();
}

bool IsWebSocketUpgrade(mg_http_message* hm) {
  return mg_http_get_header(hm, "Sec-WebSocket-Key") != nullptr;
}

std::string MgStrToString(const mg_str& value) {
  if (value.buf == nullptr || value.len == 0) {
    return "";
  }
  return std::string(value.buf, value.len);
}

bool UriStartsWithReceiver(const mg_str& uri) {
  return uri.len >= 9 && std::strncmp(uri.buf, "/receiver", 9) == 0;
}

bool UriStartsWithSenderEngine(const mg_str& uri) {
  return uri.len >= 14 && std::strncmp(uri.buf, "/sender-engine", 14) == 0;
}

bool UriHasRoleSender(const mg_str& uri, const mg_str& query) {
  const std::string uriText = MgStrToString(uri);
  const std::string queryText = MgStrToString(query);
  return uriText.find("role=sender") != std::string::npos ||
         queryText.find("role=sender") != std::string::npos;
}

bool ValidatePublicAssets(const std::string& publicDir) {
  const std::filesystem::path receiver = std::filesystem::path(publicDir) / "receiver.html";
  const std::filesystem::path engine = std::filesystem::path(publicDir) / "sender-engine.html";
  const bool receiverOk = std::filesystem::exists(receiver);
  const bool engineOk = std::filesystem::exists(engine);
  Logger::Info("Asset check receiver.html=" + std::string(receiverOk ? "ok" : "missing") +
               " path=" + receiver.string());
  Logger::Info("Asset check sender-engine.html=" + std::string(engineOk ? "ok" : "missing") +
               " path=" + engine.string());
  return receiverOk && engineOk;
}

}  // namespace

struct LocalSignalingServerImpl {
  std::thread worker;
  mg_mgr mgr{};
  mg_connection* listener = nullptr;
  mg_connection* senderConnection = nullptr;
  std::atomic<bool> running{false};
  std::mutex mutex;
  std::string publicDir;
  LanRoomInfo room{};
  std::unordered_map<mg_connection*, ReceiverConnection> receivers;
  LocalSignalingServer::SenderCallback senderCallback;
};

LocalSignalingServerImpl* GetImpl(struct mg_connection* c) {
  if (c == nullptr) {
    return nullptr;
  }
  if (c->mgr != nullptr && c->mgr->userdata != nullptr) {
    return static_cast<LocalSignalingServerImpl*>(c->mgr->userdata);
  }
  return static_cast<LocalSignalingServerImpl*>(c->fn_data);
}

LocalSignalingServer::LocalSignalingServer() : impl_(new LocalSignalingServerImpl()) {}

LocalSignalingServer::~LocalSignalingServer() {
  Stop();
  delete impl_;
}

void LocalSignalingServer::SetSenderCallback(SenderCallback callback) {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->senderCallback = std::move(callback);
}

bool LocalSignalingServer::IsRunning() const {
  return impl_->running.load();
}

LanRoomInfo LocalSignalingServer::GetRoom() const {
  std::lock_guard<std::mutex> lock(impl_->mutex);
  return impl_->room;
}

static void SendJson(struct mg_connection* connection, const std::string& json) {
  if (connection == nullptr) {
    return;
  }
  mg_ws_send(connection, json.c_str(), json.size(), WEBSOCKET_OP_TEXT);
}

static void NotifySenderApp(LocalSignalingServerImpl* impl, const std::string& json) {
  LocalSignalingServer::SenderCallback callback;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    callback = impl->senderCallback;
  }
  if (callback) {
    callback(json);
  }
}

static void NotifySender(LocalSignalingServerImpl* impl, const std::string& json) {
  LocalSignalingServer::SenderCallback callback;
  mg_connection* sender = nullptr;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    callback = impl->senderCallback;
    sender = impl->senderConnection;
  }
  if (sender != nullptr) {
    SendJson(sender, json);
  }
  if (callback) {
    callback(json);
  }
}

static mg_connection* FindReceiverConnection(LocalSignalingServerImpl* impl,
                                             const std::string& receiverId) {
  for (const auto& entry : impl->receivers) {
    if (entry.second.receiverId == receiverId) {
      return entry.first;
    }
  }
  return nullptr;
}

static void SendToReceiver(LocalSignalingServerImpl* impl, const std::string& receiverId,
                           const std::string& json) {
  mg_connection* receiverConnection = nullptr;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    receiverConnection = FindReceiverConnection(impl, receiverId);
  }
  if (receiverConnection != nullptr) {
    SendJson(receiverConnection, json);
  }
}

static std::string InjectReceiverId(const std::string& json, const std::string& receiverId) {
  if (json.find("\"receiverId\"") != std::string::npos) {
    return json;
  }
  if (json.empty() || json.front() != '{') {
    return json;
  }
  return "{\"receiverId\":\"" + JsonEscape(receiverId) + "\"," + json.substr(1);
}

static void ServeStaticFile(struct mg_connection* c, struct mg_http_message* hm, const std::string& root,
                            const std::string& relativePath) {
  const std::string fullPath = (std::filesystem::path(root) / relativePath).string();
  Logger::Info("HTTP serve file: " + fullPath);
  if (!std::filesystem::exists(fullPath)) {
    Logger::Error("HTTP file missing: " + fullPath);
    mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "Not Found");
    return;
  }
  struct mg_http_serve_opts opts{};
  opts.root_dir = root.c_str();
  opts.extra_headers = "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                       "Pragma: no-cache\r\n"
                       "Expires: 0\r\n";
  mg_http_serve_file(c, hm, fullPath.c_str(), &opts);
}

static void HandleHttpRequest(LocalSignalingServerImpl* impl, struct mg_connection* c,
                              struct mg_http_message* hm) {
  const std::string method = MgStrToString(hm->method);
  const std::string uri = MgStrToString(hm->uri);
  Logger::Info("HTTP " + method + " " + uri);

  if (IsWebSocketUpgrade(hm)) {
    const std::string query = MgStrToString(hm->query);
    Logger::Info("WebSocket upgrade requested for " + uri +
                 (query.empty() ? "" : "?" + query));
    if (UriHasRoleSender(hm->uri, hm->query)) {
      std::lock_guard<std::mutex> lock(impl->mutex);
      impl->senderConnection = c;
      Logger::Info("WebSocket sender role registered");
    }
    mg_ws_upgrade(c, hm, nullptr);
    return;
  }

  if (hm->uri.len == 1 && hm->uri.buf[0] == '/') {
    mg_http_reply(c, 302, "Location: /receiver\r\n", "");
    return;
  }

  if (UriStartsWithReceiver(hm->uri)) {
    ServeStaticFile(c, hm, impl->publicDir, "receiver.html");
    return;
  }

  if (UriStartsWithSenderEngine(hm->uri)) {
    ServeStaticFile(c, hm, impl->publicDir, "sender-engine.html");
    return;
  }

  if (method == "POST" && uri == "/engine-log") {
    const std::string body = MgStrToString(hm->body);
    const std::string message = JsonGetString(body, "message");
    if (!message.empty()) {
      Logger::Info("Engine: " + message);
    }
    mg_http_reply(c, 204, "", "");
    return;
  }

  struct mg_http_serve_opts opts{};
  opts.root_dir = impl->publicDir.c_str();
  opts.extra_headers = "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                       "Pragma: no-cache\r\n"
                       "Expires: 0\r\n";
  mg_http_serve_dir(c, hm, &opts);
}

static void RemoveReceiver(LocalSignalingServerImpl* impl, struct mg_connection* c) {
  std::string receiverId;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    const auto it = impl->receivers.find(c);
    if (it == impl->receivers.end()) {
      return;
    }
    receiverId = it->second.receiverId;
    impl->receivers.erase(it);
  }

  std::ostringstream msg;
  msg << "{\"type\":\"peer-left\",\"receiverId\":\"" << JsonEscape(receiverId) << "\"}";
  NotifySender(impl, msg.str());
  Logger::Info("Receiver left: " + receiverId);
}

static void HandleJoin(LocalSignalingServerImpl* impl, struct mg_connection* c, const std::string& json) {
  const std::string type = JsonGetString(json, "type");
  if (type != "join") {
    return;
  }

  LanRoomInfo room;
  size_t receiverCount = 0;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    room = impl->room;
    receiverCount = impl->receivers.size();
    if (static_cast<int>(receiverCount) >= impl->room.maxConnections) {
      SendJson(c, "{\"type\":\"error\",\"code\":\"room_full\"}");
      return;
    }
  }

  const std::string code = JsonGetString(json, "code");
  if (code.empty() || code != room.code) {
    Logger::Warn("Join rejected: code mismatch expected=" + room.code + " got=" + code);
    SendJson(c, "{\"type\":\"error\",\"code\":\"room_not_found\"}");
    return;
  }

  ReceiverConnection receiver{};
  receiver.receiverId = "dev-lan-" + RandomHex(6);
  receiver.joinToken = RandomHex(16);
  receiver.clientId = JsonGetString(json, "clientId");
  if (receiver.clientId.empty()) {
    receiver.clientId = "bc-" + RandomHex(8);
  }
  receiver.nickname = JsonGetString(json, "nickname");
  if (receiver.nickname.empty()) {
    receiver.nickname = "Listener";
  }

  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    impl->receivers[c] = receiver;
  }

  std::ostringstream joined;
  joined << "{\"type\":\"joined\",\"receiverId\":\"" << JsonEscape(receiver.receiverId) << "\""
         << ",\"joinToken\":\"" << JsonEscape(receiver.joinToken) << "\""
         << ",\"nickname\":\"" << JsonEscape(receiver.nickname) << "\""
         << ",\"resumed\":false}";
  SendJson(c, joined.str());

  std::ostringstream peerReady;
  peerReady << "{\"type\":\"peer-ready\",\"receiverId\":\"" << JsonEscape(receiver.receiverId) << "\""
            << ",\"nickname\":\"" << JsonEscape(receiver.nickname) << "\""
            << ",\"connections\":1,\"netType\":\"wifi\"}";
  NotifySender(impl, peerReady.str());
  Logger::Info("Receiver joined: " + receiver.nickname + " (" + receiver.receiverId + ")");
}

static void HandleWebSocketMessage(LocalSignalingServerImpl* impl, struct mg_connection* c,
                                   const std::string& json) {
  const std::string type = JsonGetString(json, "type");
  Logger::Info("WS message type=" + type + " payload=" + json);

  bool isSender = false;
  bool isReceiver = false;
  std::string receiverId;
  {
    std::lock_guard<std::mutex> lock(impl->mutex);
    isSender = (impl->senderConnection == c);
    const auto it = impl->receivers.find(c);
    if (it != impl->receivers.end()) {
      isReceiver = true;
      receiverId = it->second.receiverId;
    }
  }

  if (isSender) {
    const std::string targetReceiverId = JsonGetString(json, "targetReceiverId");
    if (!targetReceiverId.empty()) {
      SendToReceiver(impl, targetReceiverId, json);
      Logger::Info("Forwarded " + type + " to receiver " + targetReceiverId);
      if (type == "webrtc-offer") {
        NotifySenderApp(impl, json);
      }
    }
    return;
  }

  if (type == "join") {
    HandleJoin(impl, c, json);
    return;
  }
  if (type == "sender-ready" && isSender) {
    std::vector<ReceiverConnection> receivers;
    {
      std::lock_guard<std::mutex> lock(impl->mutex);
      receivers.reserve(impl->receivers.size());
      for (const auto& entry : impl->receivers) {
        receivers.push_back(entry.second);
      }
    }
    for (const auto& receiver : receivers) {
      std::ostringstream peerReady;
      peerReady << "{\"type\":\"peer-ready\",\"receiverId\":\"" << JsonEscape(receiver.receiverId) << "\""
                << ",\"nickname\":\"" << JsonEscape(receiver.nickname) << "\""
                << ",\"connections\":1,\"netType\":\"wifi\",\"resync\":true}";
      SendJson(c, peerReady.str());
    }
    Logger::Info("Sender ready; resent peer-ready for " + std::to_string(receivers.size()) + " receiver(s)");
    return;
  }
  if (type == "ping") {
    SendJson(c, "{\"type\":\"pong\"}");
    return;
  }

  if (isReceiver) {
    NotifySender(impl, InjectReceiverId(json, receiverId));
  }
}

static void EventHandler(struct mg_connection* c, int ev, void* ev_data) {
  auto* impl = GetImpl(c);
  if (impl == nullptr) {
    if (ev == MG_EV_HTTP_MSG || ev == MG_EV_WS_MSG) {
      Logger::Error("Event without server context ev=" + std::to_string(ev));
    }
    return;
  }

  if (ev == MG_EV_ACCEPT) {
    if (c->fn_data == nullptr) {
      c->fn_data = impl;
    }
    return;
  }

  if (ev == MG_EV_HTTP_MSG) {
    auto* hm = static_cast<struct mg_http_message*>(ev_data);
    HandleHttpRequest(impl, c, hm);
    return;
  }

  if (ev == MG_EV_WS_OPEN) {
    if (c == impl->senderConnection) {
      Logger::Info("WebSocket sender connection opened");
    } else {
      Logger::Info("WebSocket receiver connection opened");
    }
    return;
  }

  if (ev == MG_EV_WS_MSG) {
    auto* wm = static_cast<struct mg_ws_message*>(ev_data);
    HandleWebSocketMessage(impl, c, std::string(wm->data.buf, wm->data.len));
    return;
  }

  if (ev == MG_EV_CLOSE) {
    if (c == impl->senderConnection) {
      std::lock_guard<std::mutex> lock(impl->mutex);
      impl->senderConnection = nullptr;
      Logger::Info("Sender WebSocket connection closed");
      return;
    }
    Logger::Info("Connection closed");
    RemoveReceiver(impl, c);
  }
}

bool LocalSignalingServer::Start(const int preferredPort, const int maxConnections,
                                 const std::string& publicDir) {
  if (impl_->running.load()) {
    return true;
  }

  impl_->publicDir = publicDir;
  if (!ValidatePublicAssets(publicDir)) {
    Logger::Error("Public web assets are missing; receiver page will not load");
  }

  const std::string localIp = PickBestLocalIPv4();
  Logger::Info("Selected local IP: " + localIp);
  impl_->room.code = GenerateRoomCode();
  impl_->room.senderToken = RandomHex(16);
  impl_->room.localIp = localIp;
  impl_->room.maxConnections = maxConnections;
  impl_->room.preferredPort = preferredPort;
  impl_->room.port = preferredPort;
  impl_->room.receiverUrl = BuildReceiverUrl(localIp, preferredPort, impl_->room.code);

  mg_mgr_init(&impl_->mgr);
  impl_->mgr.userdata = impl_;

  constexpr int kPortScanCount = protocol::kLocalPortScanCount;
  int boundPort = 0;
  for (int offset = 0; offset < kPortScanCount; ++offset) {
    const int candidate = preferredPort + offset;
    const std::string listenUrl = "http://0.0.0.0:" + std::to_string(candidate);
    Logger::Info("Trying listen URL: " + listenUrl);
    impl_->listener = mg_http_listen(&impl_->mgr, listenUrl.c_str(), EventHandler, impl_);
    if (impl_->listener == nullptr) {
      Logger::Warn("Port " + std::to_string(candidate) + " unavailable");
      continue;
    }
    mg_mgr_poll(&impl_->mgr, 0);
    const int reportedPort = static_cast<int>(impl_->listener->loc.port);
    boundPort = candidate;
    if (reportedPort != 0 && reportedPort != candidate) {
      Logger::Warn("Listener reported port " + std::to_string(reportedPort) + " for requested " +
                   std::to_string(candidate) + "; using requested port");
    }
    break;
  }

  if (impl_->listener == nullptr) {
    const std::string listenUrl = "http://0.0.0.0:0";
    Logger::Warn("Ports " + std::to_string(preferredPort) + "-" +
                 std::to_string(preferredPort + kPortScanCount - 1) + " busy, trying random port");
    impl_->listener = mg_http_listen(&impl_->mgr, listenUrl.c_str(), EventHandler, impl_);
    if (impl_->listener != nullptr) {
      mg_mgr_poll(&impl_->mgr, 0);
      boundPort = static_cast<int>(impl_->listener->loc.port);
    }
  }

  if (impl_->listener == nullptr || boundPort == 0) {
    mg_mgr_free(&impl_->mgr);
    Logger::Error("Failed to start local signaling server");
    return false;
  }

  impl_->room.port = boundPort;
  impl_->room.receiverUrl = BuildReceiverUrl(localIp, boundPort, impl_->room.code);
  if (boundPort != preferredPort) {
    Logger::Warn("Preferred port " + std::to_string(preferredPort) + " unavailable; listening on " +
                 std::to_string(boundPort));
    Logger::Warn("Use Receiver URL with port " + std::to_string(boundPort) +
                 " (QR code matches this URL)");
    Logger::Warn(
        "If the receiver page does not load, allow AudioStreamSender.exe in Windows Firewall");
  }

  impl_->running.store(true);
  impl_->worker = std::thread([this]() {
    while (impl_->running.load()) {
      mg_mgr_poll(&impl_->mgr, 100);
    }
  });

  Logger::Info("Local signaling server listening on port " + std::to_string(impl_->room.port));
  Logger::Info("Serving public assets from: " + impl_->publicDir);
  return true;
}

void LocalSignalingServer::Stop() {
  if (!impl_->running.exchange(false)) {
    return;
  }
  if (impl_->worker.joinable()) {
    impl_->worker.join();
  }
  mg_mgr_free(&impl_->mgr);
  impl_->listener = nullptr;
  std::lock_guard<std::mutex> lock(impl_->mutex);
  impl_->senderConnection = nullptr;
  impl_->receivers.clear();
}

}  // namespace audiostream
