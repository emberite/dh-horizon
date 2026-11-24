/**
 * The Horizon scene, built on the fly from the hex map state:
 *   - a background image of the player-facing map (ocean, uncharted Old Valloren, sanctuaries),
 *     painted from the hex tiles in the browser and uploaded to the world folder;
 *   - one Tile per hex the GM has rolled a region for, hidden from players until the party
 *     sees it (so the GM sees the key map and the players see the map they've explored);
 *   - an overlay drawn on each client (terrain dots, shadowblight marks, region outlines for the GM,
 *     sanctuary names, collected Soul Echoes and the party's trail).
 */
import { HEX_SIZE, L, MODULE_ID, SPRITE, tileSrc } from './constants.mjs';
import { hexTile, regionOf } from './generator.mjs';
import { center, dims, key, mapSize, neighbors, parse, topLeft } from './hexmath.mjs';
import { isHorizonScene, readJourney, readMap } from './store.mjs';

const OCEAN = '#0b4a86';

/** Where a hex tile's image goes on the scene. */
export function tileRect(c, r, size = HEX_SIZE) {
    const { w } = dims(size);
    const tl = topLeft(c, r, size);
    const sy = size / SPRITE.faceH;
    return { x: tl.x, y: tl.y - SPRITE.faceTop * sy, width: w, height: SPRITE.h * sy };
}

/** Draw order: back rows first, so tall art overlaps the hexes behind it. */
const sortOf = (c, r) => Math.round(topLeft(c, r, HEX_SIZE).y * 4 + c);

/* ------------------------------------------------------------------ */
/*  Background                                                        */
/* ------------------------------------------------------------------ */

const images = new Map();
function loadImage(src) {
    if (!images.has(src)) {
        images.set(
            src,
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Could not load ${src}`));
                img.src = foundry.utils.getRoute(src);
            })
        );
    }
    return images.get(src);
}

/** Tile of a hex on the player-facing base map: what's known before anyone explores. */
function baseTile(state, k) {
    const s = state.sanctuaries[k];
    if (s) {
        if (s.fixed === 'horizon') return 'lighthouse';
        if (s.fixed === 'start') return 'castle';
        return 'town';
    }
    return state.land[k] ? 'uncharted' : 'ocean';
}

/** Paint the player-facing base map into a PNG blob. */
export async function paintBackground(state) {
    const { width, height } = mapSize(state.cols, state.rows, HEX_SIZE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, width, height);
    const cells = [];
    for (let r = 0; r <= state.rows + 1; r++) for (let c = -1; c <= state.cols; c++) cells.push({ c, r });
    cells.sort((a, b) => sortOf(a.c, a.r) - sortOf(b.c, b.r));
    for (const { c, r } of cells) {
        const k = key(c, r);
        const inside = c >= 0 && r >= 1 && c < state.cols && r <= state.rows;
        const img = await loadImage(tileSrc(inside ? baseTile(state, k) : 'ocean'));
        const rect = tileRect(c, r);
        ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
    }
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function ensureDir(dir) {
    const FP = foundry.applications.apps.FilePicker.implementation;
    let path = '';
    for (const part of dir.split('/')) {
        path = path ? `${path}/${part}` : part;
        try {
            await FP.createDirectory('data', path, {});
        } catch {
            /* exists */
        }
    }
}

/** Upload the painted base map. Returns its path. */
export async function uploadBackground(state, name) {
    const blob = await paintBackground(state);
    const dir = `worlds/${game.world.id}/${MODULE_ID}`;
    await ensureDir(dir);
    const file = new File([blob], `${name}.png`, { type: 'image/png' });
    const FP = foundry.applications.apps.FilePicker.implementation;
    const result = await FP.upload('data', dir, file, {}, { notify: false });
    if (!result?.path) throw new Error(L('Errors.Upload'));
    return result.path;
}

/* ------------------------------------------------------------------ */
/*  Scene                                                             */
/* ------------------------------------------------------------------ */

/** Create the Horizon scene for a new map (the party token is placed by the caller). */
export async function createScene(state, journey, name) {
    const { width, height } = mapSize(state.cols, state.rows, HEX_SIZE);
    const stamp = Date.now();
    const src = await uploadBackground(state, `valloren-${state.seed}-${stamp}`);
    const scene = await Scene.create({
        name,
        width,
        height,
        padding: 0,
        grid: { type: CONST.GRID_TYPES.HEXODDQ, size: HEX_SIZE, distance: 24, units: 'mi', color: '#000000', alpha: 0.12 },
        tokenVision: false,
        fog: { exploration: false },
        navigation: true,
        initial: { x: width / 2, y: height / 2, scale: 0.5 },
        flags: { [MODULE_ID]: { map: state, journey, created: stamp } }
    });
    // v14: the background belongs to the scene's (default) level
    await sceneLevel(scene).update({ 'background.src': src, 'background.color': OCEAN });
    return scene;
}

const sceneLevel = scene => scene.initialLevel ?? scene.firstLevel ?? scene.levels.contents[0];

/** Repaint the base map after sanctuaries or land changed. */
export async function refreshBackground(scene) {
    const state = readMap(scene);
    const src = await uploadBackground(state, `valloren-${state.seed}-${Date.now()}`);
    await sceneLevel(scene).update({ 'background.src': src });
}

/* ------------------------------------------------------------------ */
/*  Tiles                                                             */
/* ------------------------------------------------------------------ */

/** The tiles the map should have: one per hex with a rolled region or a known sanctuary look. */
function desiredTiles(state) {
    const out = new Map();
    for (const [k, hex] of Object.entries(state.hexes)) {
        if (!hex.region) continue;
        const { c, r } = parse(k);
        const src = tileSrc(hexTile(state, k));
        const rect = tileRect(c, r);
        // A Tile's x and y are its center (v14)
        out.set(k, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), width: Math.round(rect.width), height: Math.round(rect.height), src, hidden: !hex.revealed, sort: sortOf(c, r) });
    }
    return out;
}

/** Bring the scene's hex tiles in line with the map state. GM only. */
export async function syncTiles(scene) {
    if (!game.user.isGM) return;
    const state = readMap(scene);
    if (!state) return;
    const want = desiredTiles(state);
    const have = new Map();
    const stray = [];
    for (const tile of scene.tiles) {
        const k = tile.getFlag(MODULE_ID, 'hex');
        if (!k) continue;
        if (have.has(k) || !want.has(k)) stray.push(tile.id);
        else have.set(k, tile);
    }
    const create = [];
    const update = [];
    for (const [k, t] of want) {
        const tile = have.get(k);
        if (!tile) {
            create.push({
                texture: { src: t.src },
                x: t.x,
                y: t.y,
                width: t.width,
                height: t.height,
                hidden: t.hidden,
                sort: t.sort,
                locked: true,
                flags: { [MODULE_ID]: { hex: k } }
            });
            continue;
        }
        const diff = {};
        if (tile.texture.src !== t.src) diff['texture.src'] = t.src;
        if (tile.hidden !== t.hidden) diff.hidden = t.hidden;
        if (tile.sort !== t.sort) diff.sort = t.sort;
        if (Math.abs(tile.x - t.x) > 0.5 || Math.abs(tile.y - t.y) > 0.5) Object.assign(diff, { x: t.x, y: t.y, width: t.width, height: t.height });
        if (Object.keys(diff).length) update.push({ _id: tile.id, ...diff });
    }
    if (stray.length) await scene.deleteEmbeddedDocuments('Tile', stray);
    if (create.length) await scene.createEmbeddedDocuments('Tile', create);
    if (update.length) await scene.updateEmbeddedDocuments('Tile', update);
}

/* ------------------------------------------------------------------ */
/*  Party token                                                       */
/* ------------------------------------------------------------------ */

/** The token that marks the party on a Horizon scene. */
export function partyToken(scene) {
    return scene?.tokens.find(t => t.getFlag(MODULE_ID, 'party')) ?? null;
}

/** The hex a token stands on (by its center). */
export function tokenHex(token, changes = {}) {
    const data = { x: changes.x ?? token.x, y: changes.y ?? token.y };
    const p = token.getCenterPoint ? token.getCenterPoint(data) : { x: data.x + 1, y: data.y + 1 };
    const { i, j } = token.parent.grid.getOffset(p);
    return { c: j, r: i };
}

/** Top-left of a 1×1 token on a hex. */
export function tokenSpot(k, scene) {
    const { c, r } = parse(k);
    const { x, y } = scene.grid.getTopLeftPoint({ i: r, j: c });
    return { x, y };
}

/** The active party actor of the Daggerheart system, if any. */
export function activeParty() {
    let id = null;
    try {
        id = game.settings.get('daggerheart', 'ActiveParty');
    } catch {
        /* older system */
    }
    return game.actors.get(id) ?? game.actors.find(a => a.type === 'party') ?? null;
}

/** Characters in the party (or every player character when there's no party actor). */
export function partyMembers() {
    const party = activeParty();
    const members = (party?.system?.partyMembers ?? []).map(m => (typeof m === 'string' ? fromUuidSync(m) : m)).filter(a => a?.type === 'character');
    if (members.length) return members;
    return game.users.filter(u => !u.isGM && u.character).map(u => u.character);
}

export async function placePartyToken(scene, k) {
    const existing = partyToken(scene);
    const spot = tokenSpot(k, scene);
    if (existing) return existing.update(spot, { [MODULE_ID]: { place: true }, animate: false });
    let actor = activeParty();
    if (!actor) actor = await Actor.create({ name: L('Party.Name'), type: 'party', img: 'icons/environment/people/group.webp' });
    const proto = (await actor.getTokenDocument({ ...spot, width: 1, height: 1 })).toObject();
    proto.flags = { ...(proto.flags ?? {}), [MODULE_ID]: { party: true } };
    proto.name = actor.name;
    proto.disposition = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    proto.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;
    return (await scene.createEmbeddedDocuments('Token', [proto], { [MODULE_ID]: { place: true } }))[0];
}

/* ------------------------------------------------------------------ */
/*  Overlay                                                           */
/* ------------------------------------------------------------------ */

let overlay = null;
export const selection = { hex: null };

function drawPips(g, x, y, n, color) {
    const gap = 9;
    const start = x - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
        g.lineStyle(2, 0x1a120a, 0.9).beginFill(color, 1).drawCircle(start + i * gap, y, 3.2).endFill();
    }
}

function drawCross(g, x, y) {
    g.lineStyle(5, 0x1a120a, 0.9).moveTo(x - 7, y - 7).lineTo(x + 7, y + 7).moveTo(x + 7, y - 7).lineTo(x - 7, y + 7);
    g.lineStyle(2.5, 0xe8e8e8, 1).moveTo(x - 6, y - 6).lineTo(x + 6, y + 6).moveTo(x + 6, y - 6).lineTo(x - 6, y + 6);
}

function drawStar(g, x, y, radius, fill, alpha = 1) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? radius * 0.45 : radius;
        pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.lineStyle(2, 0x3a2600, alpha).beginFill(fill, alpha).drawPolygon(pts).endFill();
}

function hexCorners(c, r, size) {
    const p = center(c, r, size);
    const { w } = dims(size);
    const R = w / 2;
    return Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 180) * (60 * i);
        return { x: p.x + R * Math.cos(a), y: p.y + R * Math.sin(a) };
    });
}

/** Edge i of hex (c, r) faces neighbor... we just compare midpoints, which is layout-agnostic. */
function borderEdges(state, gm) {
    const edges = [];
    for (const [k, hex] of Object.entries(state.hexes)) {
        if (!hex.region) continue;
        if (!gm && !hex.revealed) continue;
        const { c, r } = parse(k);
        const corners = hexCorners(c, r, HEX_SIZE);
        for (let i = 0; i < 6; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 6];
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const p = center(c, r, HEX_SIZE);
            // neighbor across this edge: mirror the center over the edge midpoint
            const nx = 2 * mx - p.x;
            const ny = 2 * my - p.y;
            const n = neighbors(c, r).find(h => {
                const q = center(h.c, h.r, HEX_SIZE);
                return Math.abs(q.x - nx) < 2 && Math.abs(q.y - ny) < 2;
            });
            const other = n ? state.hexes[key(n.c, n.r)]?.region : null;
            if (other !== hex.region) edges.push([a, b]);
        }
    }
    return edges;
}

export function drawOverlay() {
    clearOverlay();
    if (!canvas.ready || !isHorizonScene(canvas.scene)) return;
    const state = readMap(canvas.scene);
    const journey = readJourney(canvas.scene);
    if (!state) return;
    const gm = game.user.isGM;
    const showKey = gm && game.settings.get(MODULE_ID, 'gmKey');
    const container = new PIXI.Container();
    container.eventMode = 'none';
    container.name = `${MODULE_ID}-overlay`;
    const g = new PIXI.Graphics();
    container.addChild(g);
    const size = HEX_SIZE;

    // region outlines (GM key map)
    if (showKey) {
        g.lineStyle(3, 0xfff3c4, 0.55);
        for (const [a, b] of borderEdges(state, true)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }

    // terrain dots and shadowblight marks
    for (const [k, hex] of Object.entries(state.hexes)) {
        if (!hex.region) continue;
        if (!(hex.revealed || showKey)) continue;
        const region = state.regions[hex.region];
        if (!region) continue;
        const { c, r } = parse(k);
        const p = center(c, r, size);
        drawPips(g, p.x, p.y + size * 0.36, region.terrain, hex.revealed ? 0xf6e7b0 : 0xb7a77a);
        if (region.blighted) drawCross(g, p.x, p.y - size * 0.3);
    }

    // trail
    const path = journey.path ?? [];
    if (path.length > 1) {
        g.lineStyle(5, 0x1a120a, 0.6);
        path.forEach((k, i) => {
            const { c, r } = parse(k);
            const p = center(c, r, size);
            i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        });
        g.lineStyle(2.5, 0xf4c95d, 0.95);
        path.forEach((k, i) => {
            const { c, r } = parse(k);
            const p = center(c, r, size);
            i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        });
    }

    // sanctuaries: names, Soul Echoes
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize = 22;
    style.fill = '#fff8e6';
    style.stroke = '#1a120a';
    style.strokeThickness = 5;
    const Text = foundry.canvas.containers.PreciseText;
    for (const [k, s] of Object.entries(state.sanctuaries)) {
        const { c, r } = parse(k);
        const p = center(c, r, size);
        const known = gm || s.fixed || state.hexes[k]?.revealed || game.settings.get(MODULE_ID, 'showNames');
        if (known) {
            const label = new Text(s.name, style);
            label.anchor.set(0.5, 0);
            label.position.set(p.x, p.y + size * 0.5);
            if (s.fixed === 'horizon') label.style.fill = '#ffe58a';
            container.addChild(label);
        }
        const collected = journey.collected.includes(k) || s.fixed === 'start';
        if (s.echo && showKey && !collected) drawStar(g, p.x + size * 0.38, p.y - size * 0.32, 11, 0xffd24a, 0.9);
        if ((s.echo || s.fixed === 'start') && collected) drawStar(g, p.x + size * 0.38, p.y - size * 0.32, 11, 0x9fe8ff, 1);
    }

    // selected hex (GM inspector)
    if (gm && selection.hex) {
        const { c, r } = parse(selection.hex);
        g.lineStyle(4, 0xff4fd8, 0.95).drawPolygon(hexCorners(c, r, size).flatMap(pt => [pt.x, pt.y]));
    }

    canvas.interface.addChildAt(container, 0);
    overlay = container;
}

export function clearOverlay() {
    if (overlay && !overlay.destroyed) overlay.destroy({ children: true });
    overlay = null;
}

let pending = null;
export function redrawOverlaySoon() {
    clearTimeout(pending);
    pending = setTimeout(drawOverlay, 30);
}

export { regionOf };
