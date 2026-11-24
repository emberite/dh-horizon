/**
 * Where things are kept:
 *   - the hex map (the GM's key map) and the journey on the Horizon scene's flags;
 *   - the Doom Track in a world setting (it belongs to the campaign, not to one map).
 * Only the GM writes; everything here re-renders the apps and the map overlay through the
 * updateScene / updateSetting hooks.
 */
import { MODULE_ID } from './constants.mjs';
import { emptyMap } from './generator.mjs';

const replace = value => foundry.data.operators.ForcedReplacement.create(value);

export function emptyJourney() {
    return {
        days: 0,
        shortRests: 0,
        path: [], // hex keys the party walked, in order
        log: [], // { at, to, days, habitat, terrain, encounter, mode }
        collected: [], // sanctuary keys whose Soul Echo is in the Vessel
        endurance: {}, // actorId → countdown value
        exhausted: [], // actorIds made Vulnerable by their Endurance Countdown
        mode: 'foot', // foot | downstream | upstream
        session: 1
    };
}

/** The scene holding the hex crawl: the viewed one if it is a Horizon map, else the newest. */
export function horizonScene() {
    const viewed = game.scenes.viewed;
    if (viewed?.getFlag(MODULE_ID, 'map')) return viewed;
    return game.scenes.filter(s => s.getFlag(MODULE_ID, 'map')).sort((a, b) => (b.getFlag(MODULE_ID, 'created') ?? 0) - (a.getFlag(MODULE_ID, 'created') ?? 0))[0] ?? null;
}

export const isHorizonScene = scene => !!scene?.getFlag(MODULE_ID, 'map');

export function readMap(scene = horizonScene()) {
    const saved = scene?.getFlag(MODULE_ID, 'map');
    return saved ? foundry.utils.mergeObject(emptyMap(), foundry.utils.deepClone(saved), { inplace: false }) : null;
}

export function readJourney(scene = horizonScene()) {
    const saved = scene?.getFlag(MODULE_ID, 'journey');
    return foundry.utils.mergeObject(emptyJourney(), foundry.utils.deepClone(saved ?? {}), { inplace: false });
}

/** Save map and/or journey (whole objects, so removed keys go away too). GM only. */
export async function save(scene, { map, journey } = {}, options = {}) {
    const update = {};
    if (map) update[`flags.${MODULE_ID}.map`] = replace(map);
    if (journey) update[`flags.${MODULE_ID}.journey`] = replace(journey);
    if (!Object.keys(update).length) return scene;
    return scene.update(update, options);
}

/* ------------------------------------------------------------------ */
/*  Doom Track                                                        */
/* ------------------------------------------------------------------ */

/**
 * The Doom Track: per tier, a list of boxes; a box can have nested boxes that can't be marked
 * before it. The book's track is printed in the Hope & Fear appendix (and on daggerheart.com),
 * so the GM fills in the events; these are starting points drawn from the campaign frame.
 */
export function defaultDoom() {
    // Fixed ids, so the default track can be marked before it was ever saved.
    const box = (n, k, children = []) => ({ id: `doom${n}${k}`, text: game.i18n.localize(`DHHZ.Doom.Default.T${n}.${k}`), marked: false, children });
    const tier = n => ['a', 'b', 'c'].map(k => box(n, k, n === 1 && k === 'c' ? [] : [box(n, `${k}1`)]));
    return {
        tiers: { 1: tier(1), 2: tier(2), 3: tier(3), 4: tier(4) },
        log: [] // { at, id, text, session }
    };
}

export function readDoom() {
    const saved = game.settings.get(MODULE_ID, 'doom');
    return saved?.tiers ? foundry.utils.deepClone(saved) : defaultDoom();
}

export function saveDoom(doom) {
    return game.settings.set(MODULE_ID, 'doom', doom);
}
