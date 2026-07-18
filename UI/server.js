// Orbit front-end server: static files plus a transparent proxy to the
// math-sync backend (BuildWithGemma) on 127.0.0.1:8710. Same-origin proxying
// is deliberate — math-sync sends no CORS headers and we adapt to it rather
// than patch it. SSE streams pass straight through.
//
//   node server.js          -> http://localhost:8000
//   PORT=8080 node server.js
//   BACKEND=8710 (default) points at math-sync

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8000;
const BACKEND_PORT = Number(process.env.BACKEND) || 8710;
const ROOT = __dirname;

// Shared browser modules that live in math-sync/public and must stay
// single-source (SRS scheduling, missed-question logic). We proxy the exact
// files the backend serves rather than copy them into UI/, so the scheduling
// and grading logic has one home (tested in math-sync/src/*.test.ts).
const PROXY_MODULES = new Set(["/srs.js", "/missed.js"]);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

const PROXY_PREFIXES = ["/api/", "/course-asset/", "/vendor/"];

function proxy(req, res) {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: "127.0.0.1:" + BACKEND_PORT },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "math-sync backend is not running on port " + BACKEND_PORT }));
  });
  req.pipe(upstream);
}

http
  .createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (PROXY_PREFIXES.some((p) => url === p.slice(0, -1) || url.startsWith(p))) {
      return proxy(req, res);
    }
    // Single-source browser modules (SRS/missed): serve the backend's copy.
    if (PROXY_MODULES.has(url)) {
      return proxy(req, res);
    }

    const filePath = path.resolve(ROOT, "." + (url === "/" ? "/index.html" : url));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
        "Content-Length": st.size,
      });
      fs.createReadStream(filePath).pipe(res);
    });
  })
  .listen(PORT, () => {
    console.log(
      "Orbit serving at http://localhost:" + PORT +
      " (proxying /api, /course-asset, /vendor to math-sync on :" + BACKEND_PORT + ")"
    );
  });
