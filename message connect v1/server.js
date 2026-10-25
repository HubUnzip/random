// Standalone Express server for Local Testing & Self-Hosting
const http = require("http");
const path = require("path");
const fs = require("fs");
const apiHandler = require("./api/index.js");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  // Check if API request
  if (req.url.startsWith("/api/")) {
    return apiHandler(req, res);
  }

  // Static file serving from public/
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url.split("?")[0]);

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Default to index.html for SPA
      filePath = path.join(PUBLIC_DIR, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.statusCode = 404;
        return res.end("File Not Found");
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Roblox Web Chat Relay Server Running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`⚡ API: http://localhost:${PORT}/api/messages`);
  console.log(`===============================================`);
});
