// Vercel Serverless Function & Universal API Handler
// Two-way Bridge between Web and Roblox

// In-Memory store (kept across warm lambdas)
const state = {
  messages: [
    {
      id: "sys_init",
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString(),
      sender: "system",
      author: "System",
      text: "Bridge initialized! Waiting for Roblox client or Web user messages...",
      type: "system",
      metadata: {}
    }
  ],
  commands: [],
  clients: new Map() // username -> clientData
};

// Maximum messages to retain in memory
const MAX_MESSAGES = 200;

// Helper: Upstash Redis REST persistence (optional, enabled if env vars present)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(command, ...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/${[command, ...args].map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error("Redis sync error:", err);
    return null;
  }
}

// Parse request body safely
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-secret-key");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  // Parse path & query
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/api/, "").replace(/^\//, "") || "messages";
  const query = Object.fromEntries(parsedUrl.searchParams.entries());

  // Secret Key validation (if environment variable SECRET_KEY is set)
  const serverKey = process.env.SECRET_KEY;
  if (serverKey) {
    const clientKey = req.headers["x-secret-key"] || query.key;
    if (clientKey !== serverKey) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Unauthorized: Invalid Secret Key" }));
    }
  }

  // Clean inactive clients (> 25s without heartbeat)
  const now = Date.now();
  for (const [name, client] of state.clients.entries()) {
    if (now - client.lastSeen > 25000) {
      state.clients.delete(name);
    }
  }

  // Router
  try {
    // 1. GET /api/messages - Fetch chat history or new messages
    if (pathname === "messages" && req.method === "GET") {
      const since = parseInt(query.since) || 0;
      const limit = Math.min(parseInt(query.limit) || 50, 100);
      
      let filtered = state.messages.filter(m => m.timestamp > since);
      if (filtered.length > limit) {
        filtered = filtered.slice(-limit);
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        success: true,
        count: filtered.length,
        messages: filtered,
        serverTime: Date.now()
      }));
    }

    // 2. POST /api/messages - Send a message from Web or Roblox
    if (pathname === "messages" && req.method === "POST") {
      const body = await parseBody(req);
      const text = (body.text || "").trim();
      const author = (body.author || (body.sender === "roblox" ? "Roblox Player" : "Web User")).trim();
      const sender = body.sender || "web"; // "web" | "roblox" | "system"
      const type = body.type || "chat"; // "chat" | "command" | "output" | "system"
      const metadata = body.metadata || {};

      if (!text) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Message text is required" }));
      }

      const newMsg = {
        id: "msg_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        timestamp: Date.now(),
        timeStr: new Date().toLocaleTimeString(),
        sender,
        author,
        text,
        type,
        metadata
      };

      state.messages.push(newMsg);
      if (state.messages.length > MAX_MESSAGES) {
        state.messages.shift();
      }

      // Check if message is a command trigger (e.g. starts with "/")
      if (sender === "web" && (text.startsWith("/") || text.startsWith(":"))) {
        const parts = text.slice(1).split(" ");
        const cmdName = parts[0].toLowerCase();
        const cmdArgs = parts.slice(1).join(" ");

        const newCmd = {
          id: "cmd_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
          command: cmdName,
          args: cmdArgs,
          raw: text,
          sender: author,
          timestamp: Date.now(),
          target: metadata.target || "all",
          status: "pending"
        };
        state.commands.push(newCmd);
      }

      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ success: true, message: newMsg }));
    }

    // 3. GET /api/commands - Roblox client polls for queued commands
    if (pathname === "commands" && req.method === "GET") {
      const client = query.client || "all";
      const pending = state.commands.filter(c => c.status === "pending" && (c.target === "all" || c.target === client));
      
      // Mark fetched commands as delivered/processing
      for (const cmd of pending) {
        cmd.status = "processing";
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        success: true,
        commands: pending
      }));
    }

    // 4. POST /api/commands - Web queues an explicit command
    if (pathname === "commands" && req.method === "POST") {
      const body = await parseBody(req);
      const command = (body.command || "").trim();
      const args = body.args || "";
      const target = body.target || "all";

      if (!command) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ error: "Command is required" }));
      }

      const newCmd = {
        id: "cmd_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        command,
        args,
        raw: body.raw || `:${command} ${args}`,
        sender: body.sender || "Web Operator",
        timestamp: Date.now(),
        target,
        status: "pending"
      };

      state.commands.push(newCmd);

      // Also record command in chat feed
      state.messages.push({
        id: "msg_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        timestamp: Date.now(),
        timeStr: new Date().toLocaleTimeString(),
        sender: "web",
        author: body.sender || "Web Operator",
        text: `Command queued: [${command.toUpperCase()}] ${args}`,
        type: "command",
        metadata: { commandId: newCmd.id, target }
      });

      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ success: true, command: newCmd }));
    }

    // 5. POST /api/commands/respond - Roblox returns command execution result
    if (pathname === "commands/respond" && req.method === "POST") {
      const body = await parseBody(req);
      const commandId = body.commandId;
      const status = body.status || "success";
      const output = body.output || "";
      const client = body.client || "Roblox";

      // Mark command status
      const cmd = state.commands.find(c => c.id === commandId);
      if (cmd) {
        cmd.status = status;
        cmd.output = output;
      }

      // Add output to chat messages
      state.messages.push({
        id: "msg_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        timestamp: Date.now(),
        timeStr: new Date().toLocaleTimeString(),
        sender: "roblox",
        author: `${client} (Console)`,
        text: output || `Command ${commandId} finished with status: ${status}`,
        type: "output",
        metadata: { commandId, status }
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ success: true }));
    }

    // 6. POST /api/heartbeat - Roblox client pings status & stats
    if (pathname === "heartbeat" && req.method === "POST") {
      const body = await parseBody(req);
      const username = body.username || "UnknownPlayer";

      state.clients.set(username, {
        username,
        userId: body.userId || 0,
        placeId: body.placeId || 0,
        jobId: body.jobId || "N/A",
        health: body.health !== undefined ? body.health : 100,
        maxHealth: body.maxHealth || 100,
        position: body.position || "0, 0, 0",
        fps: body.fps || 60,
        ping: body.ping || 0,
        lastSeen: Date.now()
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        success: true,
        acknowledged: true,
        clientCount: state.clients.size
      }));
    }

    // 7. GET /api/clients - Web gets list of active connected Roblox clients
    if (pathname === "clients" && req.method === "GET") {
      const clientList = Array.from(state.clients.values());
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        success: true,
        count: clientList.length,
        clients: clientList
      }));
    }

    // 8. POST /api/clear - Clears chat history
    if (pathname === "clear" && (req.method === "POST" || req.method === "DELETE")) {
      state.messages = [
        {
          id: "sys_clear",
          timestamp: Date.now(),
          timeStr: new Date().toLocaleTimeString(),
          sender: "system",
          author: "System",
          text: "Chat history has been cleared.",
          type: "system",
          metadata: {}
        }
      ];
      state.commands = [];

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ success: true, message: "Cleared" }));
    }

    // Fallback 404
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: `Endpoint not found: /api/${pathname}` }));

  } catch (error) {
    console.error("API error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Internal Server Error", details: error.message }));
  }
};
