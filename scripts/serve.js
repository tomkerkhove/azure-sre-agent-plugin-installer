// Minimal static file server used to serve the site for Playwright tests.
// Avoids adding a runtime dependency just to serve static files locally.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return;
  }
  let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Static server listening on http://127.0.0.1:${PORT}`);
});
