/**
 * Asset optimizer for Mdrn Quest.
 *
 * The runtime texture governor in game.js caps GPU memory, but it can't shrink
 * downloads or triangle counts — those are baked into the .glb files. This script
 * fixes them at the source.
 *
 * Measured problems in the current assets:
 *   shoreditch.glb   1,823,301 tris   573 MB textures (813 separate images)
 *   archway.glb      1,779,830 tris   414 MB textures (763 images)
 *   carnabyst.glb    1,344,059 tris   382 MB textures (502 images)
 *   customer.glb       149,616 tris   255 MB textures (three 4096px PNGs)
 *   liontee.glb      1,434,682 tris  — a T-SHIRT pickup
 *   police.glb       1,499,362 tris  — skinned, re-skinned every frame per officer
 *
 * Usage:
 *   cd tools && npm install
 *   npm run optimize                    # writes ./optimized/*.glb, originals untouched
 *   npm run optimize -- --only=liontee  # just one file, for quick iteration
 *   npm run optimize -- --apply         # overwrite the originals in place
 *
 * Review the files in optimized/ in a glTF viewer before using --apply.
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
    dedup, prune, resample, simplify, weld, quantize,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { encodeToKTX2 } from 'ktx2-encoder';
import draco3d from 'draco3d';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'optimized');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

/**
 * simplifyRatio — target fraction of triangles to KEEP (0.05 = 95% reduction).
 *                 1.0 skips geometry processing entirely.
 * textureSize   — longest edge in pixels after resizing; null keeps as authored.
 * ktx2          — compress textures to KTX2/ETC1S instead of resizing them.
 *
 * The city maps use ktx2 and leave geometry alone, and that combination is
 * deliberate:
 *
 *   Resizing was the wrong lever. Uncompressed RGBA8 costs 5.3 bytes/texel, so
 *   capping the map at 128px was the only way to fit iOS's budget — and 813
 *   tiles at 128px is ~1 texel per world unit, which is why buildings turned
 *   into flat colour. ETC1S stays compressed on the GPU at ~0.67 bytes/texel,
 *   so the map fits in *less* memory at its original resolution than it did
 *   capped at 128. Full quality, smaller footprint, no tradeoff.
 *
 *   Geometry is left untouched because the map has to keep matching real
 *   Shoreditch geography, and simplify() only bought 11% on carnabyst anyway
 *   (500-800 tiny primitives with locked borders). Triangles were never the
 *   problem; texture memory was.
 */
const JOBS = [
    { file: 'shoreditch.glb', simplifyRatio: 1.0, textureSize: null, ktx2: true },
    { file: 'archway.glb',    simplifyRatio: 1.0, textureSize: null, ktx2: true },
    { file: 'carnabyst.glb',  simplifyRatio: 1.0, textureSize: null, ktx2: true },

    { file: 'customer.glb',   simplifyRatio: 0.5,  error: 0.01,  textureSize: 1024 },
    { file: 'police.glb',     simplifyRatio: 0.08, error: 0.02,  textureSize: 1024 },
    { file: 'liontee.glb',    simplifyRatio: 0.05, error: 0.02,  textureSize: 1024 },
    { file: 'belt.glb',       simplifyRatio: 0.4,  error: 0.02,  textureSize: 1024 },
    { file: 'limebike.glb',   simplifyRatio: 0.4,  error: 0.02,  textureSize: 1024 },
    { file: 'playerbike.glb', simplifyRatio: 0.4,  error: 0.02,  textureSize: 1024 },
    { file: 'playermodel.glb',simplifyRatio: 0.6,  error: 0.02,  textureSize: 1024 },
    { file: 'monster_zero_ultra.glb', simplifyRatio: 1.0, error: 0.01, textureSize: 512 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// IMPORTANT: keep the "sharp" version in package.json matching the one
// @gltf-transform/functions pulls in via ndarray-pixels (^0.35.x). If they
// differ, npm nests a second copy and two native libvips instances load into
// the same process — every texture encode then fails with the very unhelpful
// "colourspace: parameter space not set", while the same image encodes fine in
// a process that loaded only one copy. `npm ls sharp` should show "deduped".
sharp.cache(false);

// ktx2-encoder has no image decoder of its own under Node and needs raw RGBA,
// so sharp supplies one. The raw-decode fallback is here for the same reason as
// in resizeTextures(): a few tiles carry a colour space libvips won't infer.
async function decodeToRGBA(buffer) {
    const src = Buffer.from(buffer);
    let out;
    try {
        out = await sharp(src, { failOn: 'none' })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    } catch {
        out = await sharp(src, { failOn: 'none' })
            .pipelineColourspace('srgb')
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
    }
    return { width: out.info.width, height: out.info.height, data: new Uint8Array(out.data) };
}

/**
 * Encode every texture to KTX2/ETC1S, one at a time.
 *
 * Deliberately not using ktx2-encoder's own gltf-transform `ktx2()` transform:
 * it runs `await Promise.all(textures.map(...))`, so a city map would launch 800+
 * concurrent decode+encode jobs and thrash or run out of memory. Sequential
 * keeps peak memory to one texture and lets us report progress on a job that
 * takes minutes.
 */
async function encodeTexturesToKTX2(doc, label) {
    const textures = doc.getRoot().listTextures();
    const encodable = new Set(['image/jpeg', 'image/png', 'image/webp']);
    let done = 0, failed = 0, skipped = 0, lastPct = -1;

    for (const texture of textures) {
        const image = texture.getImage();
        if (!image || !encodable.has(texture.getMimeType())) { skipped++; continue; }
        try {
            const out = await encodeToKTX2(image, {
                isUASTC: false,        // ETC1S — ~4x smaller than UASTC, ample for aerial photography
                qualityLevel: 200,     // [1,255]
                compressionLevel: 2,   // [0,6] encoder time vs size
                imageDecoder: decodeToRGBA,
            });
            texture.setImage(out);
            texture.setMimeType('image/ktx2');
            const uri = texture.getURI();
            if (uri) texture.setURI(uri.replace(/\.\w+$/, '.ktx2'));
            done++;
        } catch (e) {
            failed++;
            if (failed <= 3) console.log(`      ! ktx2 failed on "${texture.getName() || '?'}": ${e.message}`);
        }
        const pct = Math.floor(((done + failed + skipped) / textures.length) * 10) * 10;
        if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r      ${label}: ${pct}%   `); }
    }
    process.stdout.write('\r');

    if (done) doc.createExtension(KHRTextureBasisu).setRequired(true);

    // Once everything is KTX2, the source-format extensions have no users left.
    // prune() does not clear them, and leaving EXT_texture_webp in
    // extensionsRequired is a hard load failure for anything that doesn't
    // implement it, for no benefit.
    const stillUsed = new Set(
        doc.getRoot().listTextures().map(t => t.getMimeType())
    );
    for (const ext of doc.getRoot().listExtensionsUsed()) {
        const name = ext.extensionName;
        if (name === 'EXT_texture_webp' && !stillUsed.has('image/webp')) {
            ext.dispose();
            console.log(`      dropped unused ${name}`);
        }
    }

    console.log(`      ktx2: ${done} encoded, ${skipped} skipped, ${failed} failed`);
    return done;
}

function totalImageBytes(doc) {
    let bytes = 0;
    for (const t of doc.getRoot().listTextures()) {
        const img = t.getImage();
        if (img) bytes += img.byteLength;
    }
    return bytes;
}

function countTris(doc) {
    let tris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const idx = prim.getIndices();
            const pos = prim.getAttribute('POSITION');
            tris += idx ? idx.getCount() / 3 : (pos ? pos.getCount() / 3 : 0);
        }
    }
    return Math.round(tris);
}

/**
 * Resize every texture in the document to `maxSize` on its longest edge and
 * re-encode as WebP. Failures are reported and skipped, leaving that texture at
 * its original resolution, so a single unreadable image never costs us the file.
 */
async function resizeTextures(doc, maxSize) {
    let resized = 0, skipped = 0, failed = 0;

    for (const texture of doc.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) continue;

        try {
            // Dimensions come from glTF rather than sharp: probing with
            // sharp.metadata() and then encoding with a second instance is what
            // was leaving libvips without a colour interpretation, so every
            // texture we actually tried to resize failed to encode.
            const size = texture.getSize();
            if (!size) { skipped++; continue; }
            const [width, height] = size;
            if (Math.max(width, height) <= maxSize) { skipped++; continue; }

            const src = Buffer.from(image);
            let out;
            try {
                out = await sharp(src, { failOn: 'none' })
                    .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                    .webp({ quality: 85, effort: 4 })
                    .toBuffer();
            } catch (inner) {
                // Defensive: decoding to raw RGBA gives libvips an unambiguous
                // buffer when it can't infer an image's colour interpretation.
                console.log(`      (direct encode failed: ${inner.message} — retrying via raw decode)`);
                const { data, info } = await sharp(src, { failOn: 'none' })
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                out = await sharp(data, {
                        raw: { width: info.width, height: info.height, channels: info.channels },
                    })
                    .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                    .webp({ quality: 85, effort: 4 })
                    .toBuffer();
            }

            texture.setImage(new Uint8Array(out));
            texture.setMimeType('image/webp');
            const uri = texture.getURI();
            if (uri) texture.setURI(uri.replace(/\.\w+$/, '.webp'));
            resized++;
        } catch (e) {
            failed++;
            if (failed <= 5) {
                console.log(`      ! texture "${texture.getName() || '?'}" (${texture.getMimeType()}, ${image.byteLength}B) skipped: ${e.message}`);
            }
        }
    }

    console.log(`      textures: ${resized} resized, ${skipped} already small, ${failed} failed`);
}

async function run() {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    await MeshoptSimplifier.ready;

    // police.glb is Draco-compressed; without these the read fails outright.
    io.registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    });

    for (const job of JOBS) {
        if (ONLY && !job.file.includes(ONLY)) continue;
        const src = path.join(ROOT, job.file);
        if (!fs.existsSync(src)) {
            console.log(`skip  ${job.file} (not found)`);
            continue;
        }
        try {
            await processFile(job, src);
        } catch (e) {
            // One unreadable model shouldn't cost you the other eleven.
            console.log(`FAIL  ${job.file}: ${e.message}`);
        }
    }

    console.log(`\nOutput: ${OUT}`);
    if (!APPLY) console.log('Review these in a glTF viewer, then re-run with --apply to replace the originals.');
    console.log('\nNote: lionteegrey.glb is byte-identical to liontee.glb and is no longer');
    console.log('loaded by game.js — it can be deleted. So can "shoreditch no road data.glb"');
    console.log('and Artboard 1.pdf (9MB) if they are not used.');
}

async function processFile(job, src) {
        const beforeBytes = fs.statSync(src).size;
        const doc = await io.read(src);
        const beforeTris = countTris(doc);

        // Textures first, on a clean heap. Running them after weld()/simplify()
        // — which allocate heavily in the meshopt WASM heap — made libvips
        // intermittently lose an image's colour interpretation and fail to
        // encode. Both paths stay outside the geometry doc.transform() so one
        // bad image can't abort the whole file.
        let beforeTexBytes = 0, afterTexBytes = 0;
        if (job.ktx2) {
            beforeTexBytes = totalImageBytes(doc);
            const count = doc.getRoot().listTextures().length;
            console.log(`      encoding ${count} textures to KTX2/ETC1S (minutes for a city map)`);
            await encodeTexturesToKTX2(doc, job.file);
            afterTexBytes = totalImageBytes(doc);
        } else if (job.textureSize) {
            await resizeTextures(doc, job.textureSize);
        }

        // Geometry is only touched when a job asks for it; the maps opt out so
        // their real-world layout is preserved exactly.
        if (job.simplifyRatio < 1.0) {
            await doc.transform(
                dedup(),
                // weld() merges coincident vertices; simplify() cannot do useful
                // work on unwelded photogrammetry meshes without it.
                weld(),
                simplify({
                    simplifier: MeshoptSimplifier,
                    ratio: job.simplifyRatio,
                    error: job.error,
                    lockBorder: true, // keeps map tiles from pulling apart at their seams
                }),
                resample(),
                // Quantizing positions to 14 bits is visually lossless at this
                // scale and cuts vertex buffers substantially.
                quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
                prune(),
            );
        } else {
            await doc.transform(dedup(), prune());
        }

        const dst = path.join(OUT, job.file);
        await io.write(dst, doc);

        const afterBytes = fs.statSync(dst).size;
        const afterTris = countTris(doc);
        const pct = (n) => `${((1 - n) * 100).toFixed(0)}%`;

        console.log(
            `${job.file.padEnd(26)} ` +
            `${(beforeBytes / 1048576).toFixed(1)}MB -> ${(afterBytes / 1048576).toFixed(1)}MB (-${pct(afterBytes / beforeBytes)})  ` +
            `${beforeTris.toLocaleString()} -> ${afterTris.toLocaleString()} tris (-${pct(afterTris / beforeTris)})`
        );
        if (job.ktx2) {
            console.log(
                `      textures ${(beforeTexBytes / 1048576).toFixed(1)}MB -> ` +
                `${(afterTexBytes / 1048576).toFixed(1)}MB encoded (GPU cost drops ~8x: ETC1S stays compressed)`
            );
        }

        if (APPLY) {
            fs.copyFileSync(src, src + '.bak');
            fs.copyFileSync(dst, src);
            console.log(`      applied (original saved as ${job.file}.bak)`);
        }
}

run().catch(e => { console.error(e); process.exit(1); });
