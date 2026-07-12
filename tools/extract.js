// One-time asset extraction from mini_militia_modded.apk into assets/game/.
// - Converts the Catacombs Tiled .tmx (XML) into Tiled JSON that Phaser can load.
// - Decodes gzip+base64 tile layer data and copies collision polygons + spawns verbatim.
// - Copies the desert tileset, background, bullet/blast sprites.
// - Crops a single soldier sprite out of partsTexture.png using its .plist frame.
//
// Run: npm run extract   (requires the `unzip` CLI and the sharp npm package)

import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import assert from 'node:assert';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = join(ROOT, 'mini_militia_modded.apk');
const TMP = join(ROOT, '.apk-extract');
const OUT = join(ROOT, 'assets', 'game');

// Which map to build. Catacombs (desert theme).
const MAP_TMX = 'assets/maps/11catacombs_new.tmx';
const MAP_OUT = '11catacombs.json';
const TILESET_IMG = 'assets/hd/tile64Desert_new.png';
const BG_IMG = 'assets/hd/bgDesert_new.png';
const PARTS_PNG = 'assets/hd/partsTexture.png';
const PARTS_PLIST = 'assets/hd/partsTexture.plist';
const BULLET_IMG = 'assets/hd/bullet_new.png';
const BLAST_IMG = 'assets/hd/blast_new.png';

function unzip(entries) {
  execFileSync('unzip', ['-o', '-q', APK, ...entries, '-d', TMP], { stdio: 'inherit' });
}

function apk(p) {
  return join(TMP, p);
}

// Parse the plist frame string "{{x,y},{w,h}}" -> [x,y,w,h].
function parseFrame(plistText, key) {
  const re = new RegExp(
    `<key>${key}</key>\\s*<dict>[\\s\\S]*?<key>frame</key>\\s*<string>(\\{\\{[^}]*\\},\\{[^}]*\\}\\})</string>`
  );
  const m = plistText.match(re);
  assert(m, `frame for ${key} not found in plist`);
  const nums = m[1].match(/-?\d+/g).map(Number);
  return nums; // [x, y, w, h]
}

// "0,-1 9,-26 160,-96" -> [{x:0,y:-1},{x:9,y:-26},...]
function parsePoints(str) {
  return str.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  unzip([MAP_TMX, TILESET_IMG, BG_IMG, PARTS_PNG, PARTS_PLIST, BULLET_IMG, BLAST_IMG]);

  // --- Map: TMX (XML) -> Tiled JSON ---
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['layer', 'objectgroup', 'object', 'property'].includes(name),
  });
  const tmx = parser.parse(readFileSync(apk(MAP_TMX), 'utf8')).map;
  const mapW = Number(tmx.width);
  const mapH = Number(tmx.height);
  const tileW = Number(tmx.tilewidth);
  const tileH = Number(tmx.tileheight);

  // Tile layers: base64 -> gunzip -> uint32 LE GID array.
  const tileLayers = tmx.layer.map((layer) => {
    const raw = layer.data['#text'].trim();
    const buf = gunzipSync(Buffer.from(raw, 'base64'));
    const data = [];
    for (let i = 0; i < buf.length; i += 4) data.push(buf.readUInt32LE(i));
    assert.strictEqual(
      data.length,
      mapW * mapH,
      `layer ${layer.name}: expected ${mapW * mapH} tiles, got ${data.length}`
    );
    return {
      type: 'tilelayer',
      name: layer.name,
      width: Number(layer.width),
      height: Number(layer.height),
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      data,
    };
  });

  // Object layers: copy spawns/weapon points and collision polygons verbatim.
  const objectLayers = tmx.objectgroup.map((group) => {
    const objects = (group.object || []).map((o) => {
      const obj = {
        id: Number(o.id),
        name: o.name || '',
        x: Number(o.x),
        y: Number(o.y),
        width: Number(o.width || 0),
        height: Number(o.height || 0),
        rotation: Number(o.rotation || 0),
        visible: true,
      };
      if (o.polygon) obj.polygon = parsePoints(o.polygon.points);
      if (o.properties) {
        obj.properties = o.properties.property.map((p) => ({
          name: p.name,
          type: p.type || 'string',
          value: p.value,
        }));
      }
      return obj;
    });
    return { type: 'objectgroup', name: group.name, objects };
  });

  // Tileset. The map's GIDs were authored in Tiled against the source .tsx,
  // whose margin/spacing=2 make Tiled count 30 columns ((1984-2+2)/66 ≈ 30).
  // But the shipped PNG is packed gapless at 64px. So we must keep 30-column
  // GID numbering while sampling at a clean 64px pitch: crop the PNG to 30*64
  // wide and declare margin/spacing 0. (Reading the physical 31 columns shifts
  // every tile one step per row and turns the level into noise.)
  const meta = await sharp(apk(TILESET_IMG)).metadata();
  const margin = 0;
  const spacing = 0;
  const columns = Math.floor((meta.width - 2 * 2 + 2) / (tileW + 2)); // Tiled's count => 30
  const rows = Math.floor(meta.height / tileH);
  const cropW = columns * tileW; // 1920: drop the unused trailing column
  const tileset = {
    // firstgid 2, not 1: the packed atlas's numbering is shifted one tile from
    // the GIDs baked into the TMX (tileIndex = gid - 2). Proven empirically —
    // an edge-continuity sweep over cols/pitch/offset picks this mapping, and
    // it's the only one where terrain outlines connect across tile borders.
    firstgid: 2,
    name: 'tiles',
    image: 'tile64Desert_new.png',
    imagewidth: cropW,
    imageheight: rows * tileH,
    tilewidth: tileW,
    tileheight: tileH,
    margin,
    spacing,
    columns,
    tilecount: columns * rows,
  };

  const mapJson = {
    version: 1,
    tiledversion: '1.1.4',
    type: 'map',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: mapW,
    height: mapH,
    tilewidth: tileW,
    tileheight: tileH,
    layers: [...tileLayers, ...objectLayers],
    tilesets: [tileset],
  };

  writeFileSync(join(OUT, MAP_OUT), JSON.stringify(mapJson));

  // --- Sanity assertions ---
  const collision = objectLayers.find((l) => l.name === 'collision');
  const polys = collision.objects.filter((o) => o.polygon);
  const spawns = objectLayers
    .find((l) => l.name === 'objects')
    .objects.filter((o) => o.name.startsWith('sp_p_'));
  assert(polys.length >= 10, `expected many collision polygons, got ${polys.length}`);
  assert(spawns.length >= 2, `expected spawn points, got ${spawns.length}`);

  // --- Images ---
  // Crop to the 30-column tile area so Phaser derives 30 columns from the image.
  await sharp(apk(TILESET_IMG))
    .extract({ left: 0, top: 0, width: cropW, height: rows * tileH })
    .toFile(join(OUT, 'tile64Desert_new.png'));
  copyFileSync(apk(BG_IMG), join(OUT, 'bgDesert_new.png'));
  copyFileSync(apk(BULLET_IMG), join(OUT, 'bullet_new.png'));
  copyFileSync(apk(BLAST_IMG), join(OUT, 'blast_new.png'));

  // Soldier: composite a standing figure (head + torso + two legs) from the
  // character parts. avatarOption1 alone is just the head; the game draws the
  // gun separately, so arms are omitted to avoid a T-pose.
  const plist = readFileSync(apk(PARTS_PLIST), 'utf8');
  const cut = async (key) => {
    const [x, y, w, h] = parseFrame(plist, key);
    const buf = await sharp(apk(PARTS_PNG))
      .extract({ left: x, top: y, width: w, height: h })
      .png()
      .toBuffer();
    return { buf, w, h };
  };
  const head = await cut('avatarOption1.png'); // 122x118 face
  const body = await cut('bodyType1.png'); //     102x112 torso
  const leg = await cut('legType1.png'); //        42x60
  const CW = head.w;
  const bodyX = Math.round((CW - body.w) / 2); // centre torso under head
  const bodyY = head.h - 24; //                   overlap the head base
  const legY = bodyY + body.h - 14; //            legs at the torso base
  const CH = legY + leg.h;
  await sharp({ create: { width: CW, height: CH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: body.buf, left: bodyX, top: bodyY },
      { input: leg.buf, left: bodyX + 8, top: legY },
      { input: leg.buf, left: bodyX + body.w - leg.w - 8, top: legY },
      { input: head.buf, left: 0, top: 0 },
    ])
    .png()
    .toFile(join(OUT, 'soldier.png'));

  rmSync(TMP, { recursive: true, force: true });

  console.log('Extraction complete:');
  console.log(`  map        ${MAP_OUT}  (${mapW}x${mapH} tiles, ${polys.length} collision polys, ${spawns.length} spawns)`);
  console.log(`  tileset    tile64Desert_new.png (${meta.width}x${meta.height}, ${columns}x${rows} tiles)`);
  console.log(`  soldier    soldier.png (${CW}x${CH}, head+torso+legs)`);
  console.log(`  + bgDesert_new.png, bullet_new.png, blast_new.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
