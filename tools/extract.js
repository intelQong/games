// One-time asset extraction into assets/game/.
// - Map data (TMX) from mini_militia_modded.apk (64px tile coordinates, same GIDs).
// - Tileset image from old.apk (128px HD tiles, margin=4, spacing=4, 15 columns).
//   Each 128px tile is downscaled to 64px and packed into a gapless atlas.
// - Collision polygons, spawns, background, and sprites from the modded APK.
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
const APK_MOD = join(ROOT, 'mini_militia_modded.apk');
const APK_OLD = join(ROOT, 'old.apk');
const TMP = join(ROOT, '.apk-extract');
const OUT = join(ROOT, 'assets', 'game');

// Map data from modded APK (has 64px-coordinate object layers).
const MAP_TMX = 'assets/maps/11catacombs_new.tmx';
const MAP_OUT = '11catacombs.json';

// All art assets from old.apk (correct originals).
const TILESET_IMG = 'assets/hd/tile64Desert_new.png';
const BG_IMG = 'assets/hd/bgDesert_new.png';
const PARTS_PNG = 'assets/hd/partsTexture.png';
const PARTS_PLIST = 'assets/hd/partsTexture.plist';
const MENU_PNG = 'assets/hd/menuTexture.png';
const MENU_PLIST = 'assets/hd/menuTexture.plist';
const BULLET_IMG = 'assets/hd/bullet_new.png';
const BLAST_IMG = 'assets/hd/blast_new.png';
const THEME_MP3 = 'assets/presMix.mp3';

// Output tile size for the game (half of the 128px source tiles).
const GAME_TILE = 64;

function unzipFrom(apk, entries) {
  execFileSync('unzip', ['-o', '-q', apk, ...entries, '-d', TMP], { stdio: 'inherit' });
}

function apk(p) {
  return join(TMP, p);
}

// "0,-1 9,-26 160,-96" -> [{x:0,y:-1},{x:9,y:-26},...]
function parsePoints(str) {
  return str.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

function parsePlistToPhaserAtlas(plistText, imageName) {
  const frames = [];
  const re = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let m;
  
  const framesMatch = plistText.match(/<key>frames<\/key>\s*<dict>([\s\S]*?)<key>metadata<\/key>/);
  if (!framesMatch) return null;
  const framesText = framesMatch[1];
  
  while ((m = re.exec(framesText)) !== null) {
    const filename = m[1];
    const dictText = m[2];
    
    const frameMatch = dictText.match(/<key>frame<\/key>\s*<string>(\{\{[^}]*\},\{[^}]*\}\})<\/string>/);
    const rotatedMatch = dictText.match(/<key>rotated<\/key>\s*<(true|false)\/>/);
    const sourceSizeMatch = dictText.match(/<key>sourceSize<\/key>\s*<string>(\{[^}]*\})<\/string>/);
    const sourceColorRectMatch = dictText.match(/<key>sourceColorRect<\/key>\s*<string>(\\{\\{[^}]*\\},\\{[^}]*\\}\\})<\/string>/);
    
    if (!frameMatch) continue;
    
    const fNums = frameMatch[1].match(/-?\d+/g).map(Number); // x, y, w, h
    const rotated = rotatedMatch ? rotatedMatch[1] === 'true' : false;
    
    let w = fNums[2];
    let h = fNums[3];
    
    const ssNums = sourceSizeMatch ? sourceSizeMatch[1].match(/-?\d+/g).map(Number) : [w, h];
    
    // In Cocos2d, rotated means the image is stored rotated 90 degrees clockwise.
    // Phaser 3 TexturePacker JSON format also supports "rotated": true, where frame.w and frame.h correspond to the rotated dimensions in the atlas.
    // BUT we must be careful: Cocos2d's `frame` rect has w, h AFTER rotation if rotated=true.
    frames.push({
      filename: filename,
      rotated: rotated,
      trimmed: true,
      sourceSize: { w: ssNums[0], h: ssNums[1] },
      spriteSourceSize: { x: 0, y: 0, w: ssNums[0], h: ssNums[1] }, // Approximation, real offset requires sourceColorRect
      frame: { x: fNums[0], y: fNums[1], w: fNums[2], h: fNums[3] }
    });
  }
  
  let w = 1024, h = 1024;
  const metaMatch = plistText.match(/<key>metadata<\/key>[\s\S]*?<key>size<\/key>\s*<string>\{([^,]+),([^}]+)\}<\/string>/);
  if (metaMatch) {
    w = parseInt(metaMatch[1]);
    h = parseInt(metaMatch[2]);
  }
  
  return {
    textures: [{
      image: imageName,
      format: 'RGBA8888',
      size: { w, h },
      scale: 1,
      frames: frames
    }]
  };
}

async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // Map data from modded APK (64px object coordinates).
  unzipFrom(APK_MOD, [MAP_TMX]);
  // All art from old APK (correct originals).
  unzipFrom(APK_OLD, [TILESET_IMG, BG_IMG, PARTS_PNG, PARTS_PLIST, MENU_PNG, MENU_PLIST, BULLET_IMG, BLAST_IMG, THEME_MP3]);

  // --- Map: TMX (XML) -> Tiled JSON ---
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['layer', 'objectgroup', 'object', 'property'].includes(name),
  });
  const tmx = parser.parse(readFileSync(apk(MAP_TMX), 'utf8')).map;
  const mapW = Number(tmx.width);
  const mapH = Number(tmx.height);

  // Tile layers: base64 -> gunzip -> uint32 LE GID array.
  const tileLayers = tmx.layer.map((layer) => {
    const raw = layer.data['#text'].trim();
    const buf = gunzipSync(Buffer.from(raw, 'base64'));
    const data = [];
    for (let i = 0; i < buf.length; i += 4) data.push(buf.readUInt32LE(i));
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

  // --- Tileset: extract 128px tiles from old.apk, downscale to 64px, pack gapless ---
  const SRC_TILE = 128;
  const SRC_MARGIN = 4;
  const SRC_SPACING = 4;
  const srcMeta = await sharp(apk(TILESET_IMG)).metadata();
  const srcPitch = SRC_TILE + SRC_SPACING; // 132
  const columns = Math.floor((srcMeta.width - 2 * SRC_MARGIN + SRC_SPACING) / srcPitch); // 15
  const rows = Math.floor((srcMeta.height - 2 * SRC_MARGIN + SRC_SPACING) / srcPitch); // 15
  const tileCount = columns * rows; // 225

  const outW = columns * GAME_TILE; // 15 * 64 = 960
  const outH = rows * GAME_TILE;    // 15 * 64 = 960

  const tileComposites = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const sx = SRC_MARGIN + c * srcPitch;
      const sy = SRC_MARGIN + r * srcPitch;
      const tilePng = await sharp(apk(TILESET_IMG))
        .extract({ left: sx, top: sy, width: SRC_TILE, height: SRC_TILE })
        .resize(GAME_TILE, GAME_TILE, { kernel: 'lanczos3' })
        .png()
        .toBuffer();
      tileComposites.push({
        input: tilePng,
        left: c * GAME_TILE,
        top: r * GAME_TILE,
      });
    }
  }

  await sharp({
    create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(tileComposites)
    .png()
    .toFile(join(OUT, 'tile64Desert_new.png'));

  const tileset = {
    firstgid: 1,
    name: 'tiles',
    image: 'tile64Desert_new.png',
    imagewidth: outW,
    imageheight: outH,
    tilewidth: GAME_TILE,
    tileheight: GAME_TILE,
    margin: 0,
    spacing: 0,
    columns,
    tilecount: tileCount,
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
    tilewidth: GAME_TILE,
    tileheight: GAME_TILE,
    layers: [...tileLayers, ...objectLayers],
    tilesets: [tileset],
  };

  writeFileSync(join(OUT, MAP_OUT), JSON.stringify(mapJson));

  // --- Other images ---
  copyFileSync(apk(BG_IMG), join(OUT, 'bgDesert_new.png'));
  copyFileSync(apk(BULLET_IMG), join(OUT, 'bullet_new.png'));
  copyFileSync(apk(BLAST_IMG), join(OUT, 'blast_new.png'));
  copyFileSync(apk(PARTS_PNG), join(OUT, 'partsTexture.png'));
  copyFileSync(apk(MENU_PNG), join(OUT, 'menuTexture.png'));
  copyFileSync(apk(THEME_MP3), join(OUT, 'theme.mp3'));

  // --- Atlases ---
  const partsPlist = readFileSync(apk(PARTS_PLIST), 'utf8');
  const partsAtlas = parsePlistToPhaserAtlas(partsPlist, 'partsTexture.png');
  writeFileSync(join(OUT, 'partsTexture.json'), JSON.stringify(partsAtlas));

  const menuPlist = readFileSync(apk(MENU_PLIST), 'utf8');
  const menuAtlas = parsePlistToPhaserAtlas(menuPlist, 'menuTexture.png');
  writeFileSync(join(OUT, 'menuTexture.json'), JSON.stringify(menuAtlas));

  rmSync(TMP, { recursive: true, force: true });
  console.log('Extraction complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
