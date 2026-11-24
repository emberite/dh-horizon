#!/usr/bin/env node
/**
 * Dev tool (not loaded by the module): builds data/packs.mjs into Daggerheart system documents,
 * writes them as JSON to src/<pack>/ and compiles them into the LevelDB compendiums in packs/.
 *
 *   npm run build
 *
 * Document ids are fixed in data/packs.mjs or derived from names, so rebuilding keeps every UUID stable.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePack } from '@foundryvtt/foundryvtt-cli';
import { CONDITIONS, FEATURES, ITEMS, MOD, SOURCE, TABLES } from '../data/packs.mjs';
import { NAME_PARTS, RUMORS } from '../scripts/rumors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG = JSON.parse(await readFile(path.join(ROOT, 'lang/en.json'), 'utf8')).DHHZ;
const STATS = { coreVersion: '14.370', systemId: 'daggerheart', systemVersion: '2.12.7', createdTime: null, modifiedTime: null, lastModifiedBy: null, compendiumSource: null, duplicateSource: null };
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Stable 16-character id from a seed. */
function sid(...seed) {
    const hash = createHash('sha256').update(seed.join('/')).digest();
    return Array.from(hash.subarray(0, 16), b => ALNUM[b % ALNUM.length]).join('');
}

const attribution = () => ({ source: SOURCE, page: null, artist: '' });
const costs = cost => Object.entries(cost ?? {}).map(([key, value]) => ({ scalable: false, key, value, step: null, itemId: null, consumeOnSuccess: false }));

function damageValue(formula) {
    const m = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(String(formula).trim());
    if (!m) return { custom: { enabled: true, formula: String(formula) }, multiplier: 'flat', flatMultiplier: 1, dice: 'd6', bonus: null };
    return { custom: { enabled: false, formula: '' }, multiplier: 'flat', flatMultiplier: Number(m[1]), dice: `d${m[2]}`, bonus: m[4] ? Number(m[3] === '-' ? -m[4] : m[4]) : null };
}

function damagePart(formula, dtype = 'physical', direct = false) {
    return { value: damageValue(formula), applyTo: 'hitPoints', type: [dtype], base: false, resultBased: false, valueAlt: null, includeBase: false, direct, fullRestore: false, itemId: null };
}

function baseAction(id, name, img, extra = {}) {
    return {
        _id: id,
        type: 'effect',
        systemPath: 'actions',
        name,
        img,
        description: '',
        chatDisplay: true,
        actionType: 'action',
        cost: [],
        uses: { value: null, max: '', recovery: null, consumeOnSuccess: false },
        target: { type: 'any', amount: null },
        effects: [],
        range: '',
        areas: [],
        baseAction: false,
        originItem: { type: 'itemCollection' },
        triggers: [],
        ...extra
    };
}

function effectDoc(id, { name, img, statuses = [], changes = [], transfer = false, disabled = false, description = '' }) {
    return {
        _id: id,
        name,
        img,
        type: 'base',
        transfer,
        disabled,
        statuses,
        description,
        tint: '#ffffff',
        showIcon: 1,
        sort: 0,
        flags: {},
        system: { changes, duration: { description: '' }, rangeDependence: null, stacking: null, targetDispositions: [], conditionals: [] },
        duration: { value: null, units: 'seconds', expiry: null, expired: false },
        start: null,
        folder: null,
        _stats: STATS
    };
}

/* ------------------------------------------------------------------ */
/*  Features                                                          */
/* ------------------------------------------------------------------ */

function spellAction(featureId, a, effects) {
    const id = sid(featureId, a.name, 'action');
    const action = baseAction(id, a.name, a.img, {
        type: a.type === 'save' ? 'attack' : a.type,
        cost: costs({ stress: a.stress ?? 1 }),
        range: a.range === 'self' ? 'self' : a.range ?? ''
    });
    if (a.damage || a.stressFormula) {
        action.type = action.type === 'effect' ? 'damage' : action.type;
        const resources = {};
        if (a.stressFormula) {
            resources.stress = {
                base: false,
                applyTo: 'stress',
                resultBased: false,
                fullRestore: false,
                value: { multiplier: 'flat', flatMultiplier: 1, dice: 'd6', bonus: null, custom: { enabled: true, formula: a.stressFormula } },
                valueAlt: null,
                itemId: null
            };
        }
        action.damage = { main: a.damage ? damagePart(a.damage, a.dtype, !!a.direct) : null, resources };
    }
    if (a.type === 'attack' || a.type === 'save') {
        action.roll = {
            type: a.type === 'attack' ? 'attack' : null,
            trait: null,
            difficulty: null,
            bonus: null,
            advState: 'neutral',
            diceRolling: { multiplier: 'prof', flatMultiplier: 1, dice: 'd6', compare: null, treshold: null },
            useDefault: false
        };
        action.save = { trait: a.type === 'save' ? a.save : null, difficulty: null, damageMod: 'none' };
    }
    if (a.area) action.areas = [{ name: a.name, type: 'placed', shape: 'emanation', size: a.area, hasHole: false, effects: [] }];
    if (a.type === 'effect' && a.range === 'self') action.target = { type: 'self', amount: null };
    if (a.effect) {
        const effectId = sid(featureId, a.name, 'effect');
        effects.push(effectDoc(effectId, { name: a.effect.name, img: a.effect.img ?? a.img, statuses: a.effect.statuses ?? [], changes: a.effect.changes ?? [] }));
        action.effects = [{ _id: effectId, onSave: false }];
    }
    return action;
}

function featureDoc(def) {
    const id = def._id;
    const effects = [];
    const actions = {};
    for (const a of def.actions ?? []) {
        const action = spellAction(id, a, effects);
        actions[action._id] = action;
    }
    if (def.effect) effects.push(effectDoc(sid(id, 'effect'), { ...def.effect, img: def.img, transfer: true }));
    return {
        _id: id,
        name: def.name,
        type: 'feature',
        img: def.img,
        system: { description: def.text, featureForm: def.form, actions, resource: null, attribution: attribution(), gmNotes: '', granter: null, actorResources: [] },
        effects: effects.map(e => ({ ...e, _key: `!items.effects!${id}.${e._id}` })),
        folder: null,
        sort: 0,
        ownership: { default: 0 },
        flags: {},
        _stats: STATS,
        _key: `!items!${id}`
    };
}

function conditionDoc(def) {
    const id = def._id;
    const effectId = sid(id, 'effect');
    return {
        _id: id,
        name: def.name,
        type: 'feature',
        img: def.img,
        system: { description: def.description, featureForm: 'passive', actions: {}, resource: null, attribution: attribution(), gmNotes: '', granter: null, actorResources: [] },
        effects: [{ ...effectDoc(effectId, { name: def.name, img: def.img, statuses: def.statuses, changes: def.changes, transfer: true }), _key: `!items.effects!${id}.${effectId}` }],
        folder: null,
        sort: 0,
        ownership: { default: 0 },
        flags: { [MOD]: { condition: def.status } },
        _stats: STATS,
        _key: `!items!${id}`
    };
}

/* ------------------------------------------------------------------ */
/*  Items                                                             */
/* ------------------------------------------------------------------ */

function itemDoc(def) {
    const id = def._id;
    const a = def.action;
    const actions = a ? { [a.id]: baseAction(a.id, a.name, a.img, { target: { type: 'self', amount: null } }) } : {};
    return {
        _id: id,
        name: def.name,
        type: 'loot',
        img: def.img,
        system: { description: def.description, quantity: 1, actions, attribution: attribution(), gmNotes: '' },
        effects: [],
        folder: null,
        sort: 0,
        ownership: { default: 0 },
        flags: a ? { [MOD]: { vessel: { action: a.id } } } : {},
        _stats: STATS,
        _key: `!items!${id}`
    };
}

/* ------------------------------------------------------------------ */
/*  Roll tables                                                       */
/* ------------------------------------------------------------------ */

const HABITAT_RANGES = {
    shadowblighted: [1, 1],
    underground: [2, 2],
    aquatic: [3, 4],
    wetland: [5, 6],
    grassland: [7, 8],
    tropical: [9, 10],
    forest: [11, 12],
    drylands: [13, 14],
    rolling: [15, 16],
    mountain: [17, 18],
    frozen: [19, 19],
    badlands: [20, 20]
};

function tableRows(from) {
    if (from === 'habitat') {
        return Object.entries(HABITAT_RANGES).map(([k, range]) =>
            k === 'shadowblighted'
                ? { range, name: 'Shadowblighted', description: 'Roll again to determine which kind of habitat has been corrupted by fallen stars. If you roll another 1, the entire region has been completely overtaken and is nigh impossible to traverse.' }
                : { range, name: LANG.Habitat[k].Name, description: LANG.Habitat[k].Hint }
        );
    }
    if (from === 'encounter') return Object.entries(LANG.Encounter).map(([n, text]) => ({ range: [Number(n), Number(n)], name: `Encounter ${n}`, description: text }));
    if (from === 'terrain') return [1, 2, 3, 4].map(n => ({ range: [n, n], name: LANG.Terrain[n].Name, description: LANG.Terrain[n].Hint }));
    if (from === 'weather') {
        const text = { 1: 'A tailwind: entering the hex takes a day.', 2: 'Fair weather: entering the hex takes 2 days.', 3: 'Rough waters: entering the hex takes 3 days.', 4: 'Extreme weather: entering the hex takes 4 days.' };
        return [1, 2, 3, 4].map(n => ({ range: [n, n], name: LANG.Weather[n], description: text[n] }));
    }
    if (from === 'rumors') return RUMORS.map((text, i) => ({ range: [i + 1, i + 1], name: `Rumor ${String((i + 1) % 100).padStart(2, '0')}`, description: text }));
    if (from === 'names') return NAME_PARTS.map((text, i) => ({ range: [i + 1, i + 1], name: text, description: '' }));
    if (from.startsWith('sanctuary.')) {
        const t = from.split('.')[1];
        return Object.entries(LANG.Sanctuary[t]).map(([n, text]) => ({ range: [Number(n), Number(n)], name: text, description: '' }));
    }
    throw new Error(`Unknown table ${from}`);
}

const TABLE_TEXT = {
    names: '<p>Roll a d100 twice and combine one element from each result to name a settlement, sanctuary, or other location (for example 44 + 03: Axehead; 14 + 90: Thorne’s Church).</p>',
    rumors: '<p>A hook for a region. It could be any mixture of true or false—you decide, and you decide whether anyone in the party is aware of it.</p>'
};

function tableDoc(def) {
    const id = def._id;
    const rows = tableRows(def.from);
    return {
        _id: id,
        name: def.name,
        img: def.img,
        description: TABLE_TEXT[def.from] ?? '',
        formula: def.formula,
        replacement: true,
        displayRoll: true,
        results: rows.map((row, i) => {
            const rid = sid(id, 'result', i);
            return {
                _id: rid,
                type: 'text',
                weight: 1,
                range: row.range,
                name: row.name,
                description: row.description,
                img: def.img,
                drawn: false,
                flags: {},
                _stats: STATS,
                _key: `!tables.results!${id}.${rid}`
            };
        }),
        folder: null,
        sort: 0,
        ownership: { default: 0 },
        flags: {},
        _stats: STATS,
        _key: `!tables!${id}`
    };
}

/* ------------------------------------------------------------------ */
/*  Write and compile                                                 */
/* ------------------------------------------------------------------ */

const fileName = doc => `${doc.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')}_${doc._id}.json`;

async function writePack(name, docs) {
    const src = path.join(ROOT, 'src', name);
    await rm(src, { recursive: true, force: true });
    await mkdir(src, { recursive: true });
    for (const doc of docs) await writeFile(path.join(src, fileName(doc)), `${JSON.stringify(doc, null, 2)}\n`);
    const dest = path.join(ROOT, 'packs', name);
    await rm(dest, { recursive: true, force: true });
    await compilePack(src, dest, { log: false });
    const files = await readdir(dest);
    console.log(`${name}: ${docs.length} documents → packs/${name} (${files.length} files)`);
}

await writePack('horizon-features', [...FEATURES.map(featureDoc), ...CONDITIONS.map(conditionDoc)]);
await writePack('horizon-items', ITEMS.map(itemDoc));
await writePack('horizon-tables', TABLES.map(tableDoc));
