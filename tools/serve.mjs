// Zero-dependency static server for local testing.
//
//   node tools/serve.mjs          -> http://localhost:8123
//   node tools/serve.mjs 3000     -> http://localhost:3000
//
// The game is ES modules loading GLB/KTX2 over fetch, so it cannot run from a
// file:// URL — it needs an HTTP origin. This exists so testing a re-exported
// map does not depend on anything being installed first.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2] || '8123', 10);

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf'
};

http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';

    // Keep requests inside the project directory.
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 ' + rel);
            return;
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stat.size,
            // The maps are ~92MB and get reloaded constantly while testing.
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
}).listen(PORT, () => {
    console.log(`mdrn quest -> http://localhost:${PORT}`);
    console.log(`serving ${ROOT}`);
});
