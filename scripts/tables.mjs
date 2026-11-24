/**
 * Dice tables of the Journey to Horizon campaign frame (Daggerheart: Hope & Fear, chapter 4):
 * mapping wilderness regions, creating sanctuaries, encounters and ocean weather.
 * Pure data, no Foundry calls, so the generator can be tested outside Foundry.
 *
 * Text keys point into lang/en.json (DHHZ.Habitat.*, DHHZ.Encounter.*, ...).
 */
export { RUMORS, NAME_PARTS } from './rumors.mjs';

/**
 * Habitat (d20). `tiles` are the hex tiles a region of that habitat is drawn with (one is picked per
 * hex, the first more often); `spells` are the Terranamancer effects that fit the habitat.
 */
export const HABITATS = {
    shadowblighted: { roll: [1, 1] },
    underground: { roll: [2, 2], tiles: ['cave-hills', 'hills', 'cave-hills'], spells: ['stone'] },
    aquatic: { roll: [3, 4], tiles: ['shallows', 'shallows', 'oasis'], spells: ['water'], water: true },
    wetland: { roll: [5, 6], tiles: ['marsh', 'swamp-forest', 'marsh'], spells: ['poison'] },
    grassland: { roll: [7, 8], tiles: ['grass', 'steppe', 'fields', 'grass-trees'], spells: ['wind'] },
    tropical: { roll: [9, 10], tiles: ['jungle', 'thicket', 'swamp-forest'], spells: ['overgrowth'] },
    forest: { roll: [11, 12], tiles: ['forest', 'grass-trees', 'pine-hills'], spells: ['overgrowth'] },
    drylands: { roll: [13, 14], tiles: ['desert', 'dunes', 'canyon', 'oasis'], spells: ['heat', 'stone'] },
    rolling: { roll: [15, 16], tiles: ['hills', 'grass-trees', 'steppe'], spells: ['wind', 'poison'] },
    mountain: { roll: [17, 18], tiles: ['mountain', 'pine-hills', 'snow-mountain'], spells: ['stone', 'ice'] },
    frozen: { roll: [19, 19], tiles: ['snow', 'snow-pines', 'snow-forest', 'snow-hills', 'ice'], spells: ['ice'] },
    badlands: { roll: [20, 20], tiles: ['mesa', 'crystal', 'canyon', 'cave-desert'], spells: ['heat', 'stone'] }
};
export const HABITAT_KEYS = Object.keys(HABITATS).filter(k => k !== 'shadowblighted');

export function habitatFor(d20) {
    return Object.entries(HABITATS).find(([, h]) => d20 >= h.roll[0] && d20 <= h.roll[1])[0];
}

/** Terrain (d4): rating = days to enter a hex. */
export const TERRAIN = { 1: 'optimal', 2: 'fair', 3: 'rough', 4: 'extreme' };

/** Encounter (d8 + d6): 2–14. */
export const ENCOUNTERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** Ocean weather (d4) when entering an ocean hex by ship: result = days. */
export const OCEAN_WEATHER = { 1: 'tailwind', 2: 'fair', 3: 'rough', 4: 'extreme' };

/** Terranamancer effects ("Campaign Adversaries"). */
export const SPELLS = ['heat', 'overgrowth', 'wind', 'ice', 'poison', 'stone', 'water'];

/** Dice Tables for Creating Sanctuaries: key → die size and number of entries. */
export const SANCTUARY_TABLES = {
    trade: 20,
    quirk: 12,
    crisis: 10,
    drive: 10,
    politics: 8,
    size: 6,
    population: 4
};

/** Sanctuary tile by the habitat it sits in, and by size (5–6: large town, city). */
export function sanctuaryTile(habitat, size, coastal) {
    if (coastal && size <= 4) return 'port-left';
    if (habitat === 'frozen' || habitat === 'mountain') return size >= 5 ? 'snow-castle' : 'snow-town';
    if (habitat === 'drylands' || habitat === 'badlands') return size >= 5 ? 'temple' : 'desert-town';
    if (size >= 6) return 'castle';
    if (size >= 4) return 'town-walled';
    return 'town';
}

export const TIERS = [1, 2, 3, 4];

/** Party level from the Soul Echoes in the Vessel (the party starts with 1 and levels up with each new one). */
export const levelFor = echoes => Math.max(1, Math.min(10, echoes));
export const tierFor = level => (level >= 8 ? 4 : level >= 5 ? 3 : level >= 2 ? 2 : 1);
