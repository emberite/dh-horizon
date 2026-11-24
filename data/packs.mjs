/**
 * Compendium content of the Journey to Horizon campaign frame (Hope & Fear, chapter 4).
 * Source for tools/build-packs.mjs, which turns it into Daggerheart system documents.
 */

export const MOD = 'dh-horizon';
export const SOURCE = 'Daggerheart: Hope & Fear';

const FROSTBITTEN = [{ key: 'system.proficiency', value: -1, priority: null, type: 'add', phase: 'initial' }];

/* ------------------------------------------------------------------ */
/*  Adversary features                                                */
/* ------------------------------------------------------------------ */

export const FEATURES = [
    {
        _id: 'dhhzShadowblight',
        name: 'Shadowblighted',
        img: 'icons/magic/unholy/orb-glowing-purple.webp',
        form: 'passive',
        text: '<p>This adversary is corrupted by shadowblight; describe how this manifests in their form or demeanor. When encountered within a shadowblighted region or near a powerful source of shadowblight, this adversary critically succeeds on attacks on a die roll of <strong>18–20</strong>.</p><p><em>Turn on the “Shadowblight Empowered” effect while the adversary is in a shadowblighted region.</em></p>',
        effect: {
            name: 'Shadowblight Empowered',
            disabled: true,
            changes: [{ key: 'system.criticalThreshold', value: 18, priority: null, type: 'override', phase: 'initial' }],
            description: '<p>Critically succeeds on attacks on a roll of 18–20 while in a shadowblighted region.</p>'
        }
    },
    {
        _id: 'dhhzTerranamancr',
        name: 'Terranamancer',
        img: 'icons/magic/earth/orb-ringed-stone.webp',
        form: 'passive',
        text: `<p>This adversary can draw on terrana and use it to fuel magical effects. <strong>Mark a Stress</strong> to activate an effect based on the habitat of their current location (if an effect’s damage roll uses the adversary’s tier, roll the damage die a number of times equal to their tier and total the rolls):</p>
<ul>
<li><strong>Heat Spell</strong> (Desert, Salt Flats, Volcano): The adversary exudes oppressive supernatural heat. Each target within Very Close range must succeed on an Instinct Reaction Roll. Targets who fail must mark a Stress and take <strong>d6</strong> direct magic damage using this adversary’s tier.</li>
<li><strong>Overgrowth Spell</strong> (Forest, Jungle): This adversary unleashes a burst of branches, brambles, or vines in all directions. Each target within Close range must make an Agility Reaction Roll. Targets who fail take <strong>d8</strong> physical damage using this adversary’s tier and are <em>Restrained</em> until they break free with a successful Strength Roll.</li>
<li><strong>Wind Spell</strong> (Cliffs, Plains, Steppe): A tornado surrounds this adversary. Each target within Close range must make a Strength Reaction Roll. Targets who fail take <strong>d8</strong> magic damage using this adversary’s tier and are pushed up to Far range. Until this adversary takes damage, attack rolls against them have disadvantage.</li>
<li><strong>Ice Spell</strong> (Alpine, Glacier, Tundra): This adversary unleashes daggers of ice. Make an attack against each PC in front of this adversary within Close range. Targets they succeed against take <strong>d10</strong> magic damage using this adversary’s tier and are <em>Frostbitten</em> until they spend a Hope to clear the condition. While Frostbitten, a PC gains a −1 penalty to their Proficiency.</li>
<li><strong>Poison Spell</strong> (Moor, Swamp, Wetlands): A cloud of toxic spores explodes from this adversary. Each PC within Close range must succeed on a Strength Reaction Roll or take <strong>d6</strong> direct magic damage using this adversary’s tier and become <em>Nauseated</em> until they clear a HP. While Nauseated, a PC can’t gain Hope.</li>
<li><strong>Stone Spell</strong> (Canyon, Mountain, Badlands): This adversary gains a bonus to their damage thresholds equal to their tier until they take Severe damage or use this feature again.</li>
<li><strong>Water Spell</strong> (Riverlands, Sea): This adversary unleashes a geyser or tidal wave. Make an attack against all targets within Very Close range. Targets they succeed against are pushed to Close range of where they were and mark a number of Stress equal to this adversary’s tier.</li>
</ul>`,
        actions: [
            { name: 'Heat Spell', img: 'icons/magic/fire/flame-burning-hand-orange.webp', type: 'save', save: 'instinct', range: 'veryClose', area: 'veryClose', damage: '(@tier)d6', dtype: 'magical', direct: true, stress: 1 },
            { name: 'Overgrowth Spell', img: 'icons/magic/nature/root-vine-entangle-foot-green.webp', type: 'save', save: 'agility', range: 'close', area: 'close', damage: '(@tier)d8', dtype: 'physical', effect: { name: 'Restrained', statuses: ['restrained'] } },
            { name: 'Wind Spell', img: 'icons/magic/air/wind-tornado-funnel-green.webp', type: 'save', save: 'strength', range: 'close', area: 'close', damage: '(@tier)d8', dtype: 'magical' },
            { name: 'Ice Spell', img: 'icons/magic/water/projectile-ice-shard.webp', type: 'attack', range: 'close', damage: '(@tier)d10', dtype: 'magical', effect: { name: 'Frostbitten', statuses: ['frostbitten'], changes: FROSTBITTEN, img: 'icons/magic/water/snowflake-ice-blue-white.webp' } },
            { name: 'Poison Spell', img: 'icons/magic/unholy/orb-smoking-green.webp', type: 'save', save: 'strength', range: 'close', area: 'close', damage: '(@tier)d6', dtype: 'magical', direct: true, effect: { name: 'Nauseated', statuses: ['nauseated'], img: 'icons/magic/unholy/orb-smoking-green.webp' } },
            { name: 'Stone Spell', img: 'icons/magic/earth/barrier-stone-brown-green.webp', type: 'effect', range: 'self' },
            { name: 'Water Spell', img: 'icons/magic/water/wave-water-blue.webp', type: 'attack', range: 'veryClose', area: 'veryClose', stressFormula: '@tier' }
        ]
    }
];

/* ------------------------------------------------------------------ */
/*  Conditions (as items, for characters)                             */
/* ------------------------------------------------------------------ */

export const CONDITIONS = [
    {
        _id: 'dhhzCondFrostbt0',
        name: 'Frostbitten',
        img: 'icons/magic/water/snowflake-ice-blue-white.webp',
        status: 'frostbitten',
        statuses: ['frostbitten'],
        changes: FROSTBITTEN,
        description: '<p>From a Terranamancer’s <strong>Ice Spell</strong>. While Frostbitten, a PC gains a −1 penalty to their Proficiency. Spend a Hope to clear the condition.</p>'
    },
    {
        _id: 'dhhzCondNausea00',
        name: 'Nauseated',
        img: 'icons/magic/unholy/orb-smoking-green.webp',
        status: 'nauseated',
        statuses: ['nauseated'],
        changes: [],
        description: '<p>From a Terranamancer’s <strong>Poison Spell</strong>. While Nauseated, a PC can’t gain Hope. The condition clears when they clear a HP.</p>'
    }
];

/* ------------------------------------------------------------------ */
/*  Items                                                             */
/* ------------------------------------------------------------------ */

export const ITEMS = [
    {
        _id: 'dhhzVesselLight0',
        name: 'Vessel of Light',
        img: 'icons/magic/light/orb-lightbulb-gray.webp',
        description: `<p><em>Created by High Priestess Saraya to securely gather and transport Aurelia’s Soul Echoes.</em> Its nature is for your table to decide: a seemingly mundane object (a carved urn, a large acorn that must be planted in her grave), an obviously magical item of power (a glowing orb hidden under thick velvet), or a child or creature named Echo who must be cared for by the party.</p>
<p>The Soul Echoes inside are sustained by terrana from the earth and must remain close to the ground lest they fade and perish, so the party can’t significantly shorten their journey by flying across Valloren.</p>
<p><strong>Locate Soul Echoes:</strong> As a downtime move, commune with the Vessel and have the Echoes within call out to their sisters. You learn the direction (north, south, east, west, or a combination) of the nearest sanctuary with a Soul Echo at its shrine. At the GM’s discretion, this alerts nearby Seekers-in-Shadow of the Vessel’s general direction as well.</p>
<p>The party levels up each time they add a new Soul Echo to the Vessel. With all ten, they must carry it to the Cliffs of Horizon.</p>`,
        action: { id: 'dhhzLocateAction', name: 'Locate Soul Echoes', img: 'icons/magic/light/orb-lightbulb-gray.webp' }
    }
];

/* ------------------------------------------------------------------ */
/*  Roll tables                                                       */
/* ------------------------------------------------------------------ */

/** Built from lang/en.json and scripts/rumors.mjs by the build tool. */
export const TABLES = [
    { _id: 'dhhzTblHabitat00', name: 'Journey to Horizon: Habitat (d20)', formula: '1d20', from: 'habitat', img: 'icons/environment/wilderness/tree-oak.webp' },
    { _id: 'dhhzTblEncounter', name: 'Journey to Horizon: Encounter (d8 + d6)', formula: '1d8 + 1d6', from: 'encounter', img: 'icons/skills/melee/weapons-crossed-swords-yellow.webp' },
    { _id: 'dhhzTblTerrain00', name: 'Journey to Horizon: Terrain (d4)', formula: '1d4', from: 'terrain', img: 'icons/environment/settlement/road-paved.webp' },
    { _id: 'dhhzTblRumors000', name: 'Journey to Horizon: Rumors (d100)', formula: '1d100', from: 'rumors', img: 'icons/sundries/scrolls/scroll-bound-sealed-brown.webp' },
    { _id: 'dhhzTblWeather00', name: 'Journey to Horizon: Ocean Weather (d4)', formula: '1d4', from: 'weather', img: 'icons/magic/air/weather-clouds-rain.webp' },
    { _id: 'dhhzTblTrade0000', name: 'Sanctuary: Trade and Exports (d20)', formula: '1d20', from: 'sanctuary.trade', img: 'icons/commodities/currency/coins-assorted-mix-copper.webp' },
    { _id: 'dhhzTblQuirk0000', name: 'Sanctuary: Quirk (d12)', formula: '1d12', from: 'sanctuary.quirk', img: 'icons/sundries/misc/mask-venetian-gold.webp' },
    { _id: 'dhhzTblCrisis000', name: 'Sanctuary: Crisis (d10)', formula: '1d10', from: 'sanctuary.crisis', img: 'icons/magic/fire/projectile-meteor-salvo-strong-red.webp' },
    { _id: 'dhhzTblDrive0000', name: 'Sanctuary: Drive (d10)', formula: '1d10', from: 'sanctuary.drive', img: 'icons/sundries/flags/banner-flag-white.webp' },
    { _id: 'dhhzTblPolitics0', name: 'Sanctuary: Political System (d8)', formula: '1d8', from: 'sanctuary.politics', img: 'icons/commodities/treasure/crown-gold-laurel-wreath.webp' },
    { _id: 'dhhzTblSize00000', name: 'Sanctuary: Size (d6)', formula: '1d6', from: 'sanctuary.size', img: 'icons/environment/settlement/house-two-chimneys.webp' },
    { _id: 'dhhzTblPopulatin', name: 'Sanctuary: Population (d4)', formula: '1d4', from: 'sanctuary.population', img: 'icons/environment/people/group.webp' },
    { _id: 'dhhzTblNames0000', name: 'Settlement Name (d100 × 2)', formula: '1d100', from: 'names', img: 'icons/sundries/documents/document-sealed-signatures-red.webp' }
];
