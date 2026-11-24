/**
 * Hex geometry for a flat-topped "odd-q" grid, the layout of Foundry's "Hexagonal Columns (Odd)"
 * grid type: odd columns sit half a hex lower than even ones. Pure functions, no Foundry calls.
 *
 * A hex is addressed by column c and row r (Foundry's j and i). Rows start at 1 so that even
 * columns, which Foundry draws half a row higher, never reach above the top of the scene.
 */

export const key = (c, r) => `${c},${r}`;
export function parse(k) {
    const [c, r] = String(k).split(',').map(Number);
    return { c, r };
}

const EVEN = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [0, 1]
];
const ODD = [
    [1, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1]
];

/** The six hexes around (c, r), clipped to a cols × rows map when given. */
export function neighbors(c, r, cols = Infinity, rows = Infinity) {
    const dirs = c & 1 ? ODD : EVEN;
    return dirs.map(([dc, dr]) => ({ c: c + dc, r: r + dr })).filter(h => h.c >= 0 && h.r >= 1 && h.c < cols && h.r <= rows);
}

export function toCube(c, r) {
    const x = c;
    const z = r - (c - (c & 1)) / 2;
    return { x, y: -x - z, z };
}

export function fromCube({ x, z }) {
    return { c: x, r: z + (x - (x & 1)) / 2 };
}

export function distance(a, b) {
    const p = toCube(a.c, a.r);
    const q = toCube(b.c, b.r);
    return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
}

function cubeRound(x, y, z) {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { x: rx, y: ry, z: rz };
}

/** Hexes on the straight line from a to b, a excluded, b included. */
export function line(a, b) {
    const n = distance(a, b);
    const p = toCube(a.c, a.r);
    const q = toCube(b.c, b.r);
    const out = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const e = 1e-6;
        out.push(fromCube(cubeRound(p.x + (q.x - p.x) * t + e, p.y + (q.y - p.y) * t + e, p.z + (q.z - p.z) * t - 2 * e)));
    }
    return out;
}

/** Pixel size of a hex: `size` is the height (flat side to flat side), as Foundry's grid size. */
export function dims(size) {
    return { w: size * (2 / Math.sqrt(3)), h: size };
}

export function topLeft(c, r, size) {
    const { w } = dims(size);
    return { x: 0.75 * w * c, y: (r - (c & 1 ? 0 : 0.5)) * size };
}

export function center(c, r, size) {
    const { w } = dims(size);
    const tl = topLeft(c, r, size);
    return { x: tl.x + w / 2, y: tl.y + size / 2 };
}

/** The hex under a pixel. */
export function fromPoint(x, y, size) {
    const { w } = dims(size);
    // cube coordinates of a flat-top layout with the origin at hex (0,0)'s center, then shift by our origin
    const ox = w / 2;
    const oy = 0; // center of (0, 1) even column is at y = 0.5*size + 0.5*size - 0.5*size
    const px = x - ox;
    const py = y - oy - size; // center of hex (0,1) sits at (w/2, size)
    const radius = w / 2;
    const q = ((2 / 3) * px) / radius;
    const rr = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / radius;
    const cube = cubeRound(q, -q - rr, rr);
    const h = fromCube(cube);
    return { c: h.c, r: h.r + 1 };
}

/** Pixel size of a whole map of cols × rows hexes. */
export function mapSize(cols, rows, size) {
    const { w } = dims(size);
    return { width: Math.ceil(0.75 * w * (cols - 1) + w), height: Math.ceil((rows + 1) * size) };
}

/** Eight-way compass direction from a to b, in screen terms (north is up). */
export function compass(a, b, size = 100) {
    const p = center(a.c, a.r, size);
    const q = center(b.c, b.r, size);
    const angle = (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI; // 0 = east, 90 = north
    const dirs = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
    return dirs[((Math.round(angle / 45) % 8) + 8) % 8];
}
