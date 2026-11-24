export const MODULE_ID = 'dh-horizon';
export const HF_ID = 'daggerheart-hope-and-fear';
export const SYSTEM_ID = 'daggerheart';

/** Hex tiles by The Clover Patch (CC BY 4.0), cut and scaled by tools/slice-tiles.py. */
export const TILE_PATH = `modules/${MODULE_ID}/assets/tiles`;
export const tileSrc = name => `${TILE_PATH}/${name}.png`;
/** Tile images are 32×48 pixel art scaled 4×; the hex face is 32×28 with its top edge at y = 18. */
export const SPRITE = { w: 32, h: 48, faceH: 28, faceTop: 18 };

/** Hex height on the scene (Foundry grid size). 4 × the 28px face, so the art scales evenly. */
export const HEX_SIZE = 112;

/** Art from the Hope & Fear module. */
const HF_BOOK = `modules/${HF_ID}/assets/art/book`;
export const ART = {
    intro: `${HF_BOOK}/journey-intro.webp`,
    terrain: `${HF_BOOK}/journey-terrain.webp`,
    starfall: `${HF_BOOK}/journey-starfall.webp`,
    seeker: `${HF_BOOK}/journey-seekerinshadow.webp`,
    doom: `${HF_BOOK}/journey-sorrowblightdoom.webp`,
    inciting: `${HF_BOOK}/journey-incitingincident.webp`,
    ruins: `${HF_BOOK}/journey-ruins.webp`,
    map: `${HF_BOOK}/journey-to-horizon-valloren-map-with-layers-repaired-middle-dec-11-2025.webp`
};

/** Pages of the Hope & Fear rulebook compendium. */
const HF_CHAPTER = `Compendium.${HF_ID}.rules.JournalEntry.daghfear06chapte.JournalEntryPage`;
export const HF_PAGES = {
    hexCrawl: `${HF_CHAPTER}.06thehexcrawl000`,
    keyMap: `${HF_CHAPTER}.06preparingthe00`,
    sanctuaries: `${HF_CHAPTER}.06dicetablesfo01`,
    travelDays: `${HF_CHAPTER}.06traveldays0000`,
    doomTrack: `${HF_CHAPTER}.06doomtrack00000`
};

export const PACKS = {
    features: `${MODULE_ID}.horizon-features`,
    items: `${MODULE_ID}.horizon-items`,
    tables: `${MODULE_ID}.horizon-tables`
};

/** Condition ids added by this module. */
export const CONDITION = { frostbitten: 'frostbitten', nauseated: 'nauseated' };

/** Downtime move id and the marker its description carries into the chat card. */
export const LOCATE_MOVE = 'dhhzLocateEchoes';
export const LOCATE_MARK = 'data-dhhz-move="locate-echoes"';

export const ENDURANCE_START = 6;
export const MAX_SHORT_RESTS = 3;

/** Localize under this module's namespace, with optional format data. */
export const L = (key, data) => (data ? game.i18n.format(`DHHZ.${key}`, data) : game.i18n.localize(`DHHZ.${key}`));

export const hasHF = () => !!game.modules.get(HF_ID)?.active;
export const esc = s => foundry.utils.escapeHTML(String(s ?? ''));
