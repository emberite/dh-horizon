import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRegion, around, createMap, ensureRegions, hexTile, rng, rollRegion, rollSanctuary, settlementName } from '../scripts/generator.mjs';
import { center, compass, distance, fromPoint, key, line, neighbors, parse } from '../scripts/hexmath.mjs';
import { habitatFor, levelFor, tierFor } from '../scripts/tables.mjs';

test('hex neighbors are at distance 1 and round-trip through pixels', () => {
    for (let c = 0; c < 12; c++) {
        for (let r = 1; r < 10; r++) {
            for (const n of neighbors(c, r)) assert.equal(distance({ c, r }, n), 1);
            const p = center(c, r, 112);
            assert.deepEqual(fromPoint(p.x + 10, p.y - 10, 112), { c, r });
        }
    }
});

test('line walks one hex at a time', () => {
    const path = line({ c: 0, r: 1 }, { c: 9, r: 7 });
    let prev = { c: 0, r: 1 };
    for (const h of path) {
        assert.equal(distance(prev, h), 1);
        prev = h;
    }
    assert.deepEqual(prev, { c: 9, r: 7 });
});

test('compass directions', () => {
    assert.equal(compass({ c: 5, r: 5 }, { c: 5, r: 1 }), 'north');
    assert.equal(compass({ c: 5, r: 5 }, { c: 11, r: 5 }), 'east');
    assert.equal(compass({ c: 5, r: 5 }, { c: 0, r: 10 }), 'southwest');
});

test('habitat table ranges', () => {
    assert.equal(habitatFor(1), 'shadowblighted');
    assert.equal(habitatFor(2), 'underground');
    assert.equal(habitatFor(4), 'aquatic');
    assert.equal(habitatFor(12), 'forest');
    assert.equal(habitatFor(19), 'frozen');
    assert.equal(habitatFor(20), 'badlands');
});

test('levels and tiers follow the Soul Echoes', () => {
    assert.equal(levelFor(1), 1);
    assert.equal(tierFor(1), 1);
    assert.equal(tierFor(2), 2);
    assert.equal(tierFor(5), 3);
    assert.equal(tierFor(8), 4);
    assert.equal(levelFor(12), 10);
});

test('regions roll within the tables', () => {
    const random = rng(7);
    for (let i = 0; i < 500; i++) {
        const r = rollRegion(random);
        assert.ok(r.size >= 1 && r.size <= 12);
        assert.ok(r.encounter >= 2 && r.encounter <= 14);
        assert.ok(r.terrain >= 1 && r.terrain <= 4);
        assert.ok(r.rumor >= 1 && r.rumor <= 100);
        assert.notEqual(r.habitat, 'shadowblighted');
    }
});

test('a new map has Marrogate, Horizon, sanctuaries and nine Soul Echoes', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
        const m = createMap({ seed });
        const start = parse(m.start);
        const horizon = parse(m.horizon);
        assert.ok(m.land[m.start] && m.land[m.horizon]);
        assert.ok(horizon.c > start.c && horizon.r < start.r, 'Horizon lies northeast of Marrogate');
        assert.equal(Object.values(m.sanctuaries).filter(s => s.echo).length, 9);
        assert.ok(Object.keys(m.sanctuaries).length >= 30);
        // the same seed builds the same map
        assert.deepEqual(createMap({ seed }).land, m.land);
    }
});

test('regions are contiguous land and cover the area asked for', () => {
    const m = createMap({ seed: 5 });
    ensureRegions(m, around(m, m.start, 4));
    for (const region of Object.values(m.regions)) {
        assert.ok(region.hexes.length <= region.size);
        for (const k of region.hexes) assert.ok(m.land[k]);
        // connected
        const seen = new Set([region.hexes[0]]);
        const queue = [region.hexes[0]];
        while (queue.length) {
            const { c, r } = parse(queue.pop());
            for (const n of neighbors(c, r)) {
                const nk = key(n.c, n.r);
                if (region.hexes.includes(nk) && !seen.has(nk)) {
                    seen.add(nk);
                    queue.push(nk);
                }
            }
        }
        assert.equal(seen.size, region.hexes.length);
    }
    for (const k of around(m, m.start, 4)) if (m.land[k]) assert.ok(m.hexes[k]?.region, `${k} has a region`);
    assert.ok(hexTile(m, m.start));
});

test('sanctuaries and names', () => {
    const random = rng(3);
    const s = rollSanctuary(random);
    assert.ok(s.name.length > 2);
    assert.ok(s.rolls.trade >= 1 && s.rolls.trade <= 20);
    for (let i = 0; i < 200; i++) assert.ok(!/[()]/.test(settlementName(random)));
});

test('a region can be forced', () => {
    const m = createMap({ seed: 8 });
    const region = addRegion(m, m.start, { habitat: 'frozen', terrain: 4, size: 3 });
    assert.equal(region.habitat, 'frozen');
    assert.equal(region.terrain, 4);
});
