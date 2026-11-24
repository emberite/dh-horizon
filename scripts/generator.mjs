/**
 * Procedural New Valloren: the continent, its sanctuaries and Soul Echoes, wilderness regions rolled
 * on the Journey to Horizon dice tables, and sanctuaries rolled on the sanctuary tables.
 * Pure functions over plain objects (no Foundry calls), seeded so a map can be rebuilt exactly.
 *
 * Map state (stored on the scene):
 *   { cols, rows, seed, land: { "c,r": true }, hexes: { "c,r": Hex }, regions: { id: Region },
 *     sanctuaries: { "c,r": Sanctuary }, start, horizon, ... }
 */
import { distance, key, neighbors, parse } from './hexmath.mjs';
import { HABITATS, NAME_PARTS, RUMORS, SANCTUARY_TABLES, habitatFor, sanctuaryTile } from './tables.mjs';

/* ------------------------------------------------------------------ */
/*  Random numbers                                                    */
/* ------------------------------------------------------------------ */

/** Seeded PRNG (mulberry32). */
export function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.die = faces => 1 + Math.floor(next() * faces);
    next.pick = list => list[Math.floor(next() * list.length)];
    next.state = () => a;
    return next;
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/* ------------------------------------------------------------------ */
/*  The continent                                                     */
/* ------------------------------------------------------------------ */

/** Smooth value noise in [0, 1]. */
function valueNoise(random, cols, rows, cell) {
    const gw = Math.ceil(cols / cell) + 2;
    const gh = Math.ceil(rows / cell) + 2;
    const grid = Array.from({ length: gw * gh }, () => random());
    const at = (x, y) => grid[y * gw + x];
    const smooth = t => t * t * (3 - 2 * t);
    return (c, r) => {
        const x = c / cell;
        const y = r / cell;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const sx = smooth(x - x0);
        const sy = smooth(y - y0);
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        return top * (1 - sy) + bottom * sy;
    };
}

/** All land hexes connected to `from` (6-neighbor flood fill). */
function component(land, from, cols, rows) {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
        const { c, r } = parse(queue.pop());
        for (const n of neighbors(c, r, cols, rows)) {
            const k = key(n.c, n.r);
            if (land[k] && !seen.has(k)) {
                seen.add(k);
                queue.push(k);
            }
        }
    }
    return seen;
}

/**
 * A continent stretched from the southwest (Marrogate) to the northeast (the Cliffs of Horizon),
 * with bays, inland seas and a few islands, like the map of Old Valloren.
 */
export function makeLand(random, cols, rows) {
    const coarse = valueNoise(random, cols, rows, 7);
    const fine = valueNoise(random, cols, rows, 3);
    const land = {};
    for (let c = 0; c < cols; c++) {
        for (let r = 1; r <= rows; r++) {
            const u = c / (cols - 1);
            const v = 1 - (r - 1) / (rows - 1); // 0 = south, 1 = north
            // distance from the SW–NE spine, measured across it
            const across = Math.abs(v - (0.15 + 0.7 * u)) * 1.6;
            const edge = Math.min(c, cols - 1 - c, r - 1, rows - r);
            const n = coarse(c, r) * 0.65 + fine(c, r) * 0.35;
            const height = n + 0.55 - across - (edge < 1 ? 1 : edge < 2 ? 0.25 : 0);
            if (height > 0.5) land[key(c, r)] = true;
        }
    }
    return land;
}

/** Pick the corner hexes and keep only the land connected to them (plus islands near the coast). */
function shapeContinent(random, land, cols, rows) {
    const keys = Object.keys(land);
    const score = (k, sx, sy) => {
        const { c, r } = parse(k);
        return c * sx + (rows - r) * sy;
    };
    const start = keys.reduce((a, b) => (score(b, -1, -1) > score(a, -1, -1) ? b : a));
    const horizon = keys.reduce((a, b) => (score(b, 1, 1.2) > score(a, 1, 1.2) ? b : a));
    let main = component(land, start, cols, rows);
    if (!main.has(horizon)) {
        // Join the two with a land bridge.
        const a = parse(start);
        const b = parse(horizon);
        let cur = a;
        while (distance(cur, b) > 0) {
            const next = neighbors(cur.c, cur.r, cols, rows).sort((x, y) => distance(x, b) - distance(y, b))[0];
            land[key(next.c, next.r)] = true;
            cur = next;
        }
        main = component(land, start, cols, rows);
    }
    for (const k of Object.keys(land)) {
        if (main.has(k)) continue;
        const size = component(land, k, cols, rows).size;
        if (size < 2 || random() < 0.35) delete land[k];
    }
    return { start, horizon };
}

/** Land hexes that touch the ocean. */
export function isCoastal(state, k) {
    const { c, r } = parse(k);
    const around = neighbors(c, r, state.cols, state.rows);
    return around.length < 6 || around.some(n => !state.land[key(n.c, n.r)]);
}

/* ------------------------------------------------------------------ */
/*  Sanctuaries and Soul Echoes                                       */
/* ------------------------------------------------------------------ */

/** Settlement Name (d100×2): combine one element from each roll. */
export function settlementName(random) {
    const variant = part => {
        const options = part.split(',').map(s => s.trim());
        const p = random.pick(options);
        // "Axe(l)" → "Axe" or "Axel"; "H(e)aven" → "Haven" or "Heaven"
        return p.replace(/\(([^)]*)\)/g, (_, inside) => (random() < 0.5 ? inside : ''));
    };
    const a = variant(NAME_PARTS[random.die(100) - 1]);
    const b = variant(NAME_PARTS[random.die(100) - 1]);
    if (a.toLowerCase() === b.toLowerCase()) return a;
    const roll = random();
    if (roll < 0.12) return `${a}’s ${b}`;
    if (roll < 0.2) return `${a} ${b}`;
    return a + b.toLowerCase();
}

/** Roll a sanctuary on the Dice Tables for Creating Sanctuaries. */
export function rollSanctuary(random, extra = {}) {
    const rolls = {};
    for (const [table, faces] of Object.entries(SANCTUARY_TABLES)) rolls[table] = random.die(faces);
    if (rolls.politics === 8) {
        let a = random.die(7);
        let b = random.die(7);
        while (b === a) b = random.die(7);
        rolls.politicsMix = [a, b];
    }
    return { name: settlementName(random), rolls, generated: true, notes: '', ...extra };
}

/** Spread sanctuaries over the land, at least `gap` hexes apart. */
function placeSanctuaries(random, state, count, gap) {
    const land = Object.keys(state.land).filter(k => k !== state.start && k !== state.horizon);
    const placed = [parse(state.start), parse(state.horizon)];
    const out = [];
    let tries = 0;
    while (out.length < count && tries < count * 400) {
        tries++;
        const k = random.pick(land);
        const h = parse(k);
        if (placed.some(p => distance(p, h) < gap)) continue;
        placed.push(h);
        out.push(k);
    }
    return out;
}

/**
 * Choose nine sanctuaries for the Soul Echoes, spread fairly evenly from west to east so the party
 * collects Echoes early and ends close to Horizon with the last one.
 */
export function placeEchoes(random, state, count = 9) {
    const candidates = Object.keys(state.sanctuaries).filter(k => k !== state.start && k !== state.horizon);
    if (!candidates.length) return [];
    const xs = candidates.map(k => parse(k).c);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const chosen = [];
    for (let band = 0; band < count; band++) {
        const lo = min + ((max - min + 1) * band) / count;
        const hi = min + ((max - min + 1) * (band + 1)) / count;
        let pool = candidates.filter(k => !chosen.includes(k) && parse(k).c >= lo && parse(k).c < hi);
        if (!pool.length) {
            const mid = (lo + hi) / 2;
            pool = candidates.filter(k => !chosen.includes(k)).sort((a, b) => Math.abs(parse(a).c - mid) - Math.abs(parse(b).c - mid)).slice(0, 2);
        }
        if (!pool.length) break;
        // Avoid predictable lines: prefer a sanctuary away from the previous Echo's row.
        const prev = chosen.length ? parse(chosen[chosen.length - 1]) : null;
        pool.sort(() => random() - 0.5);
        if (prev) pool.sort((a, b) => Math.abs(parse(b).r - prev.r) - Math.abs(parse(a).r - prev.r) + (random() - 0.5) * 6);
        chosen.push(pool[0]);
    }
    return chosen;
}

/* ------------------------------------------------------------------ */
/*  A new map                                                         */
/* ------------------------------------------------------------------ */

export function emptyMap() {
    return {
        version: 1,
        cols: 0,
        rows: 0,
        seed: 0,
        land: {},
        hexes: {},
        regions: {},
        sanctuaries: {},
        start: null,
        horizon: null,
        party: null,
        rng: 0,
        nextRegion: 1
    };
}

/**
 * Build a new continent: land, Marrogate in the far southwest, the Cliffs of Horizon at the
 * northeastern tip, sanctuaries and the nine Soul Echoes. Regions are rolled later, as the party
 * comes near them (or all at once with prepareAll).
 */
export function createMap({ cols = 36, rows = 24, sanctuaries = 40, gap = 3, seed = newSeed(), names = {} } = {}) {
    const random = rng(seed);
    const state = emptyMap();
    Object.assign(state, { cols, rows, seed });
    state.land = makeLand(random, cols, rows);
    const { start, horizon } = shapeContinent(random, state.land, cols, rows);
    state.start = start;
    state.horizon = horizon;
    state.party = start;
    state.sanctuaries[start] = { name: names.start ?? 'Marrogate', fixed: 'start', rolls: null, notes: '', generated: false };
    state.sanctuaries[horizon] = { name: names.horizon ?? 'Horizon', fixed: 'horizon', rolls: null, notes: '', generated: false };
    for (const k of placeSanctuaries(random, state, sanctuaries, gap)) state.sanctuaries[k] = { name: settlementName(random), rolls: null, notes: '', generated: false };
    for (const k of placeEchoes(random, state)) state.sanctuaries[k].echo = true;
    state.rng = random.state();
    return state;
}

/* ------------------------------------------------------------------ */
/*  Wilderness regions                                                */
/* ------------------------------------------------------------------ */

/** Roll a region on the four mapping tables (plus the rumor). */
export function rollRegion(random) {
    const d20 = random.die(20);
    let habitat = habitatFor(d20);
    let blighted = false;
    let overtaken = false;
    let reroll = null;
    if (habitat === 'shadowblighted') {
        blighted = true;
        reroll = random.die(20);
        if (reroll === 1) {
            overtaken = true;
            // the habitat underneath is still something; roll until it isn't blight
            let again = random.die(20);
            while (again === 1) again = random.die(20);
            habitat = habitatFor(again);
        } else habitat = habitatFor(reroll);
    }
    const d8 = random.die(8);
    const d6 = random.die(6);
    return {
        habitat,
        blighted,
        overtaken,
        size: random.die(12),
        encounter: d8 + d6,
        terrain: random.die(4),
        rumor: random.die(100),
        encounterDie: 6,
        rolls: { habitat: d20, reroll, size: null, encounter: [d8, d6] },
        notes: '',
        encounterUsed: false,
        rumorKnown: false
    };
}

/**
 * Grow a region of `size` contiguous hexes from `seedKey` over land hexes that have no region yet.
 * Frontier hexes with more neighbors already in the region are favored, which keeps regions
 * compact and avoids encircling empty hexes.
 */
export function growRegion(random, state, seedKey, size) {
    const cells = [seedKey];
    const inRegion = new Set(cells);
    const free = k => state.land[k] && !state.hexes[k]?.region && !inRegion.has(k);
    while (cells.length < size) {
        const frontier = new Map();
        for (const k of cells) {
            const { c, r } = parse(k);
            for (const n of neighbors(c, r, state.cols, state.rows)) {
                const nk = key(n.c, n.r);
                if (!free(nk)) continue;
                const touching = neighbors(n.c, n.r, state.cols, state.rows).filter(m => inRegion.has(key(m.c, m.r))).length;
                frontier.set(nk, touching);
            }
        }
        if (!frontier.size) break;
        const weighted = [...frontier].flatMap(([k, w]) => Array(w * w).fill(k));
        const pick = random.pick(weighted);
        cells.push(pick);
        inRegion.add(pick);
    }
    return cells;
}

/** Pick the tile for one hex of a region. */
export function tileFor(random, region) {
    const tiles = HABITATS[region.habitat].tiles;
    return random() < 0.5 ? tiles[0] : random.pick(tiles);
}

/**
 * Roll a new region that contains `seedKey` and write it into the state (mutates and returns it).
 * `forced` overrides any rolled field (habitat, size, terrain, ...).
 */
export function addRegion(state, seedKey, forced = {}) {
    const random = rng(state.rng || state.seed);
    const region = { ...rollRegion(random), ...forced };
    region.id = `r${state.nextRegion++}`;
    const cells = growRegion(random, state, seedKey, region.size);
    region.hexes = cells;
    state.regions[region.id] = region;
    for (const k of cells) state.hexes[k] = { ...(state.hexes[k] ?? {}), region: region.id, tile: tileFor(random, region) };
    state.rng = random.state();
    return region;
}

/** Make sure every land hex in `keys` belongs to a region, rolling new ones as needed. Returns the new regions. */
export function ensureRegions(state, keys) {
    const made = [];
    for (const k of keys) {
        if (!state.land[k] || state.hexes[k]?.region) continue;
        made.push(addRegion(state, k));
    }
    return made;
}

/** Roll the details of a sanctuary the first time they're needed. */
export function ensureSanctuary(state, k) {
    const s = state.sanctuaries[k];
    if (!s || s.rolls || s.fixed) return s;
    const random = rng(state.rng || state.seed);
    Object.assign(s, rollSanctuary(random, { name: s.name, echo: s.echo }));
    state.rng = random.state();
    return s;
}

/** Re-roll a region in place (same hexes), keeping nothing but its id. */
export function rerollRegion(state, id, forced = {}) {
    const old = state.regions[id];
    if (!old) return null;
    const random = rng(state.rng || state.seed);
    const region = { ...rollRegion(random), ...forced, id, hexes: old.hexes, size: old.hexes.length };
    state.regions[id] = region;
    for (const k of old.hexes) state.hexes[k] = { ...(state.hexes[k] ?? {}), region: id, tile: tileFor(random, region) };
    state.rng = random.state();
    return region;
}

/** Change the habitat of a region and redraw its tiles. */
export function setHabitat(state, id, habitat) {
    const region = state.regions[id];
    if (!region || !HABITATS[habitat]?.tiles) return null;
    const random = rng(state.rng || state.seed);
    region.habitat = habitat;
    for (const k of region.hexes) state.hexes[k].tile = tileFor(random, region);
    state.rng = random.state();
    return region;
}

/** Hexes within `radius` of a hex. */
export function around(state, k, radius) {
    const center = parse(k);
    const out = [];
    for (let c = center.c - radius - 1; c <= center.c + radius + 1; c++) {
        for (let r = center.r - radius - 1; r <= center.r + radius + 1; r++) {
            if (c < 0 || r < 1 || c >= state.cols || r > state.rows) continue;
            if (distance(center, { c, r }) <= radius) out.push(key(c, r));
        }
    }
    return out;
}

/** Tile shown for a hex on the map (sanctuaries get a settlement). */
export function hexTile(state, k) {
    const s = state.sanctuaries[k];
    const hex = state.hexes[k];
    const region = hex?.region ? state.regions[hex.region] : null;
    if (s) {
        if (s.fixed === 'horizon') return 'lighthouse';
        if (s.fixed === 'start') return 'castle';
        return sanctuaryTile(region?.habitat, s.rolls?.size ?? 3, isCoastal(state, k));
    }
    if (!state.land[k]) return 'ocean';
    if (!hex?.tile) return 'uncharted';
    return region?.blighted ? `${hex.tile}-blight` : hex.tile;
}

/** The region of a hex, or null. */
export const regionOf = (state, k) => state.regions[state.hexes[k]?.region] ?? null;

export const rumorText = n => RUMORS[(n - 1 + 100) % 100];
