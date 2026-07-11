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

  // Tileset: derive columns/tilecount from image dims + margin/spacing.
  const meta = await sharp(apk(TILESET_IMG)).metadata();
  const margin = 2;
  const spacing = 2;
  const columns = Math.floor((meta.width - 2 * margin + spacing) / (tileW + spacing));
  const rows = Math.floor((meta.height - 2 * margin + spacing) / (tileH + spacing));
  const tileset = {
    firstgid: 1,
    name: 'tiles',
    image: 'tile64Desert_new.png',
    imagewidth: meta.width,
    imageheight: meta.height,
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
  copyFileSync(apk(TILESET_IMG), join(OUT, 'tile64Desert_new.png'));
  copyFileSync(apk(BG_IMG), join(OUT, 'bgDesert_new.png'));
  copyFileSync(apk(BULLET_IMG), join(OUT, 'bullet_new.png'));
  copyFileSync(apk(BLAST_IMG), join(OUT, 'blast_new.png'));

  // Soldier: crop avatarOption1.png frame out of partsTexture.png.
  const [fx, fy, fw, fh] = parseFrame(readFileSync(apk(PARTS_PLIST), 'utf8'), 'avatarOption1.png');
  await sharp(apk(PARTS_PNG))
    .extract({ left: fx, top: fy, width: fw, height: fh })
    .toFile(join(OUT, 'soldier.png'));

  rmSync(TMP, { recursive: true, force: true });

  console.log('Extraction complete:');
  console.log(`  map        ${MAP_OUT}  (${mapW}x${mapH} tiles, ${polys.length} collision polys, ${spawns.length} spawns)`);
  console.log(`  tileset    tile64Desert_new.png (${meta.width}x${meta.height}, ${columns}x${rows} tiles)`);
  console.log(`  soldier    soldier.png (${fw}x${fh} @ ${fx},${fy})`);
  console.log(`  + bgDesert_new.png, bullet_new.png, blast_new.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
