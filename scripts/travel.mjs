/**
 * The journey procedure: moving the party hex by hex, travel days, encounter rolls, revealing the
 * map around the party (rolling new regions as it goes), rests, Soul Echoes and the optional
 * Endurance Countdowns. Runs on the GM's client; chat cards carry the results to the table.
 */
import { ENDURANCE_START, L, MAX_SHORT_RESTS, MODULE_ID, esc, tileSrc } from './constants.mjs';
import { around, ensureRegions, ensureSanctuary, hexTile, regionOf, rumorText } from './generator.mjs';
import { compass, distance, key, line, neighbors, parse } from './hexmath.mjs';
import { partyMembers, partyToken, redrawOverlaySoon, syncTiles, tokenHex } from './scene.mjs';
import { isHorizonScene, readJourney, readMap, save } from './store.mjs';
import { levelFor, tierFor } from './tables.mjs';

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/* ------------------------------------------------------------------ */
/*  Revealing the map                                                 */
/* ------------------------------------------------------------------ */

/**
 * The party knows its current hex and the hexes next to it. Regions are rolled for everything
 * within the GM's preparation radius, so the GM's key map stays a step ahead of the players.
 */
export function revealAround(state, k) {
    const { c, r } = parse(k);
    const seen = [k, ...neighbors(c, r, state.cols, state.rows).map(n => key(n.c, n.r))];
    const prep = Math.max(1, Number(game.settings.get(MODULE_ID, 'prepRadius')) || 1);
    const made = ensureRegions(state, around(state, k, prep));
    for (const s of around(state, k, prep + 1)) if (state.sanctuaries[s]) ensureSanctuary(state, s);
    const newly = [];
    for (const h of seen) {
        if (!state.land[h]) continue;
        state.hexes[h] ??= {};
        if (!state.hexes[h].revealed) newly.push(h);
        state.hexes[h].revealed = true;
    }
    return { made, newly };
}

/* ------------------------------------------------------------------ */
/*  Dice                                                              */
/* ------------------------------------------------------------------ */

async function roll(formula, { gm = true, flavor = '' } = {}) {
    const r = await new Roll(formula).evaluate();
    if (game.modules.get('dice-so-nice')?.active && game.dice3d) {
        await game.dice3d.showForRoll(r, game.user, true, gm ? gmIds() : null, gm && game.settings.get(MODULE_ID, 'blindEncounters')).catch(() => {});
    }
    return r;
}

const diceValues = r => r.dice.flatMap(d => d.results.filter(x => x.active !== false).map(x => x.result));

/** An entry of the Encounter table, resolving "roll twice and combine". */
export async function rollEncounterEntry() {
    const pick = async () => {
        const r = await roll('1d8 + 1d6');
        return r.total;
    };
    const first = await pick();
    if (first !== 2) return [first];
    const out = [];
    while (out.length < 2) {
        const n = await pick();
        if (n !== 2) out.push(n);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/*  Travel                                                            */
/* ------------------------------------------------------------------ */

/** Days to enter a hex: its terrain rating, adjusted for river travel; ocean hexes roll the weather. */
export async function daysToEnter(state, k, mode) {
    if (!state.land[k]) {
        const w = await roll('1d4');
        return { days: w.total, weather: w.total, rating: w.total, ocean: true };
    }
    const region = regionOf(state, k);
    const rating = region?.terrain ?? 2;
    let days = rating;
    if (mode === 'downstream') days = Math.max(1, rating - 1);
    if (mode === 'upstream') days = rating + 1;
    return { days, rating, ocean: false };
}

/**
 * Move the party along a path of hexes, one at a time. `options.silent` skips cards (GM placing the
 * party by hand).
 */
export async function travel(scene, fromKey, toKey, options = {}) {
    let state = readMap(scene);
    let journey = readJourney(scene);
    if (!state) return;
    const steps = line(parse(fromKey), parse(toKey)).map(h => key(h.c, h.r));
    if (!steps.length) return;
    if (options.silent) {
        state.party = toKey;
        revealAround(state, toKey);
        await save(scene, { map: state, journey });
        await syncTiles(scene);
        return;
    }
    for (const k of steps) {
        const result = await step(state, journey, k);
        await save(scene, { map: state, journey });
        await syncTiles(scene);
        await postStep(scene, state, journey, result);
        if (result.endurance) await postEndurance(result.endurance);
        state = readMap(scene);
        journey = readJourney(scene);
    }
}

async function step(state, journey, k) {
    const mode = journey.mode ?? 'foot';
    const travelDays = await daysToEnter(state, k, mode);
    state.party = k;
    const { newly } = revealAround(state, k);
    const region = regionOf(state, k);
    const sanctuary = state.sanctuaries[k] ?? null;
    if (sanctuary) ensureSanctuary(state, k);

    // Encounter dice: one per point of terrain rating, a 1 triggers an encounter.
    const count = Math.max(1, travelDays.rating);
    const faces = region?.encounterDie ?? 6;
    const encounterRoll = await roll(`${count}d${faces}`);
    const values = diceValues(encounterRoll);
    const triggered = values.includes(1);
    let entries = [];
    let fresh = false;
    if (triggered) {
        if (region && !region.encounterUsed) {
            entries = [region.encounter];
            region.encounterUsed = true;
            if (region.encounter === 2) entries = await rollEncounterEntry();
        } else {
            entries = await rollEncounterEntry();
            fresh = true;
        }
    }

    journey.days += travelDays.days;
    journey.path = [...(journey.path ?? []), k].slice(-400);
    const entry = {
        at: Date.now(),
        to: k,
        days: travelDays.days,
        total: journey.days,
        habitat: region?.habitat ?? (travelDays.ocean ? 'ocean' : null),
        terrain: travelDays.rating,
        encounter: triggered ? entries : null,
        dice: values,
        mode: travelDays.ocean ? 'ship' : mode,
        weather: travelDays.weather ?? null
    };
    journey.log = [...(journey.log ?? []), entry].slice(-200);

    const endurance = !sanctuary && state.land[k] && game.settings.get(MODULE_ID, 'endurance') ? await enduranceStep(journey) : null;
    return { k, region, sanctuary, travelDays, values, faces, triggered, entries, fresh, newly, endurance, mode: entry.mode };
}

function habitatLabel(region) {
    if (!region) return '';
    const base = L(`Habitat.${region.habitat}.Name`);
    return region.blighted ? L('Habitat.Blighted', { habitat: base }) : base;
}

/** The public card (where the party is, how long it took) and the GM card (dice, encounter, rumor). */
async function postStep(scene, state, journey, res) {
    const { k, region, sanctuary, travelDays, values, faces, triggered, entries, fresh } = res;
    const img = tileSrc(hexTile(state, k));
    const place = sanctuary ? esc(sanctuary.name) : travelDays.ocean ? L('Habitat.ocean.Name') : habitatLabel(region);
    const terrain = travelDays.ocean ? L(`Weather.${travelDays.weather}`) : L(`Terrain.${travelDays.rating}.Name`);
    const modeText = res.mode !== 'foot' ? ` <span class="hz-mode">${L(`Mode.${res.mode}`)}</span>` : '';
    const publicHtml = `<div class="dh-horizon-chat travel">
        <img class="hz-tile" src="${img}" alt="">
        <div class="hz-body">
            <h3>${place}</h3>
            <p>${L('Chat.Travel', { days: travelDays.days, terrain })}${modeText}</p>
            <p class="hz-total">${L('Chat.Total', { days: journey.days })}</p>
            ${sanctuary ? `<p class="hz-sanctuary"><i class="fa-solid fa-tree-city"></i> ${L('Chat.Sanctuary')}</p>` : ''}
        </div>
    </div>`;
    await ChatMessage.create({ content: publicHtml, speaker: { alias: L('Chat.Journey') }, flags: { [MODULE_ID]: { card: 'travel', scene: scene.id, hex: k } } });

    const dice = values.map(v => `<span class="hz-die ${v === 1 ? 'one' : ''}">${v}</span>`).join('');
    let body;
    if (triggered) {
        const list = entries.map(n => `<li><strong>${n}</strong> ${L(`Encounter.${n}`)}</li>`).join('');
        body = `<p class="hz-alert">${fresh ? L('Chat.EncounterNew') : L('Chat.EncounterPrepared')}</p><ul class="hz-encounters">${list}</ul>${encounterButtons(entries)}`;
    } else {
        body = `<p>${L('Chat.NoEncounter')}</p><div class="hz-buttons"><button type="button" data-hz="spendFear"><i class="fa-solid fa-skull"></i> ${L('Chat.SpendFear')}</button></div>`;
    }
    const rumor = region ? `<details class="hz-rumor"><summary>${L('Chat.Rumor')} (${String(region.rumor).padStart(2, '0')})</summary><p>${esc(rumorText(region.rumor))}</p><button type="button" data-hz="shareRumor"><i class="fa-solid fa-comment"></i> ${L('Chat.ShareRumor')}</button></details>` : '';
    const notes = region?.notes ? `<details class="hz-notes"><summary>${L('Hex.Notes')}</summary><p>${esc(region.notes)}</p></details>` : '';
    const echo = sanctuary?.echo && !journey.collected.includes(k) ? `<p class="hz-echo"><i class="fa-solid fa-star"></i> ${L('Chat.EchoHere')}</p>` : '';
    const gmHtml = `<div class="dh-horizon-chat encounter">
        <h3>${L('Chat.EncounterDice', { count: values.length, faces })}</h3>
        <div class="hz-dice">${dice}</div>
        ${body}${echo}${rumor}${notes}
    </div>`;
    await ChatMessage.create({
        content: gmHtml,
        whisper: gmIds(),
        speaker: { alias: L('Chat.KeyMap') },
        flags: { [MODULE_ID]: { card: 'encounter', scene: scene.id, hex: k, rumor: region?.rumor ?? null } }
    });
}

function encounterButtons(entries) {
    const btns = [];
    if (entries.includes(4)) btns.push(`<button type="button" data-hz="fearPerPC"><i class="fa-solid fa-skull"></i> ${L('Chat.FearPerPC')}</button>`);
    if (entries.includes(12)) btns.push(`<button type="button" data-hz="hopeEach"><i class="fa-solid fa-sun"></i> ${L('Chat.HopeEach')}</button>`);
    return btns.length ? `<div class="hz-buttons">${btns.join('')}</div>` : '';
}

/* ------------------------------------------------------------------ */
/*  Fear and Hope from the cards                                      */
/* ------------------------------------------------------------------ */

function currentFear() {
    try {
        return Number(game.settings.get('daggerheart', 'ResourcesFear')) || 0;
    } catch {
        return 0;
    }
}

async function setFear(value) {
    const max = Number(game.settings.get('daggerheart', 'Homebrew')?.maxFear ?? 12) || 12;
    const v = Math.max(0, Math.min(max, value));
    if (ui.resources?.updateFear) return ui.resources.updateFear(v);
    return game.settings.set('daggerheart', 'ResourcesFear', v);
}

async function gainHope(actor, n = 1) {
    const hope = actor.system.resources?.hope;
    if (!hope) return;
    await actor.update({ 'system.resources.hope.value': Math.min(hope.max ?? 6, (hope.value ?? 0) + n) });
}

export async function onCardButton(message, action) {
    if (!game.user.isGM) return;
    const flags = message.getFlag(MODULE_ID, 'card') ? message.flags[MODULE_ID] : null;
    if (action === 'spendFear') {
        const fear = currentFear();
        if (fear < 1) return ui.notifications.warn(L('Chat.NoFear'));
        await setFear(fear - 1);
        const scene = game.scenes.get(flags?.scene);
        const state = scene ? readMap(scene) : null;
        const region = state ? regionOf(state, flags.hex) : null;
        let entries;
        let fresh = false;
        if (region && !region.encounterUsed) {
            entries = region.encounter === 2 ? await rollEncounterEntry() : [region.encounter];
            region.encounterUsed = true;
            await save(scene, { map: state });
        } else {
            entries = await rollEncounterEntry();
            fresh = true;
        }
        const list = entries.map(n => `<li><strong>${n}</strong> ${L(`Encounter.${n}`)}</li>`).join('');
        await ChatMessage.create({
            content: `<div class="dh-horizon-chat encounter"><h3>${L('Chat.FearSpent')}</h3><p class="hz-alert">${fresh ? L('Chat.EncounterNew') : L('Chat.EncounterPrepared')}</p><ul class="hz-encounters">${list}</ul>${encounterButtons(entries)}</div>`,
            whisper: gmIds(),
            speaker: { alias: L('Chat.KeyMap') },
            flags: { [MODULE_ID]: { card: 'encounter', scene: flags?.scene, hex: flags?.hex } }
        });
    } else if (action === 'fearPerPC') {
        const n = partyMembers().length;
        await setFear(currentFear() + n);
        ui.notifications.info(L('Chat.FearGained', { n }));
    } else if (action === 'hopeEach') {
        const members = partyMembers();
        for (const a of members) await gainHope(a, 1);
        await ChatMessage.create({ content: `<div class="dh-horizon-chat"><p><i class="fa-solid fa-sun"></i> ${L('Chat.HopeGained', { names: members.map(a => esc(a.name)).join(', ') })}</p></div>`, speaker: { alias: L('Chat.Journey') } });
    } else if (action === 'shareRumor') {
        const n = flags?.rumor;
        if (!n) return;
        await ChatMessage.create({ content: `<div class="dh-horizon-chat rumor"><h3>${L('Chat.RumorHeard')}</h3><blockquote>${esc(rumorText(n))}</blockquote></div>`, speaker: { alias: L('Chat.Journey') } });
        const scene = game.scenes.get(flags.scene);
        const state = scene ? readMap(scene) : null;
        const region = state ? regionOf(state, flags.hex) : null;
        if (region) {
            region.rumorKnown = true;
            await save(scene, { map: state });
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Endurance Countdowns (optional rule)                              */
/* ------------------------------------------------------------------ */

async function enduranceStep(journey) {
    const results = [];
    for (const actor of partyMembers()) {
        const id = actor.id;
        if (journey.exhausted.includes(id)) continue;
        const countdown = journey.endurance[id] ?? ENDURANCE_START;
        const faces = actor.system.rules?.dualityRoll?.defaultHopeDice ?? 12;
        const r = await roll(`1d${faces}`, { gm: false });
        const value = r.total;
        const res = { actor, value, faces, before: countdown, stress: false, triggered: false };
        if (value <= countdown) {
            res.stress = true;
            const stress = actor.system.resources?.stress;
            if (stress) await actor.update({ 'system.resources.stress.value': Math.min(stress.max ?? 6, (stress.value ?? 0) + 1) });
        } else {
            journey.endurance[id] = countdown - 1;
            if (journey.endurance[id] <= 0) {
                res.triggered = true;
                journey.exhausted.push(id);
                await actor.toggleStatusEffect('vulnerable', { active: true }).catch(() => {});
            }
        }
        res.after = journey.endurance[id] ?? countdown;
        results.push(res);
    }
    return results;
}

async function postEndurance(results) {
    if (!results.length) return;
    const rows = results
        .map(
            r => `<li><img src="${r.actor.img}" alt=""><span class="hz-name">${esc(r.actor.name)}</span><span class="hz-die">${r.value}</span>
            <span>${r.triggered ? L('Endurance.Triggered') : r.stress ? L('Endurance.Stress') : L('Endurance.Tick', { n: r.after })}</span></li>`
        )
        .join('');
    await ChatMessage.create({ content: `<div class="dh-horizon-chat endurance"><h3>${L('Endurance.Title')}</h3><ul>${rows}</ul></div>`, speaker: { alias: L('Chat.Journey') } });
}

/** At the end of a rest the Countdowns start over, and the Vulnerable they caused ends. */
async function resetEndurance(journey) {
    for (const id of journey.exhausted ?? []) {
        const actor = game.actors.get(id);
        if (actor?.statuses?.has('vulnerable')) await actor.toggleStatusEffect('vulnerable', { active: false }).catch(() => {});
    }
    journey.endurance = {};
    journey.exhausted = [];
}

/* ------------------------------------------------------------------ */
/*  Rests                                                             */
/* ------------------------------------------------------------------ */

export function atSanctuary(state) {
    return !!(state?.party && state.sanctuaries[state.party]);
}

export async function takeRest(scene, kind) {
    const state = readMap(scene);
    const journey = readJourney(scene);
    if (kind === 'short') {
        if (journey.shortRests >= MAX_SHORT_RESTS) return ui.notifications.warn(L('Rest.NeedLong'));
        journey.shortRests += 1;
        journey.days += 1;
    } else {
        if (!atSanctuary(state)) return ui.notifications.warn(L('Rest.LongOnlySanctuary'));
        journey.shortRests = 0;
        journey.days += 3;
    }
    await resetEndurance(journey);
    await save(scene, { journey });
    const text = kind === 'short' ? L('Rest.ShortTaken', { n: journey.shortRests, max: MAX_SHORT_RESTS }) : L('Rest.LongTaken', { name: esc(state.sanctuaries[state.party]?.name) });
    await ChatMessage.create({ content: `<div class="dh-horizon-chat rest"><p><i class="fa-solid fa-campground"></i> ${text}</p></div>`, speaker: { alias: L('Chat.Journey') } });
}

/* ------------------------------------------------------------------ */
/*  Soul Echoes                                                       */
/* ------------------------------------------------------------------ */

export function echoCount(state, journey) {
    return 1 + journey.collected.filter(k => state.sanctuaries[k]?.echo).length;
}

export function partyLevel(state, journey) {
    return levelFor(echoCount(state, journey));
}

export function partyTier(state, journey) {
    return tierFor(partyLevel(state, journey));
}

export async function collectEcho(scene, k) {
    const state = readMap(scene);
    const journey = readJourney(scene);
    const s = state.sanctuaries[k];
    if (!s?.echo || journey.collected.includes(k)) return;
    journey.collected = [...journey.collected, k];
    await save(scene, { journey });
    const count = echoCount(state, journey);
    const done = count >= 10;
    await ChatMessage.create({
        content: `<div class="dh-horizon-chat echo"><h3><i class="fa-solid fa-star"></i> ${L('Echo.Collected', { name: esc(s.name) })}</h3>
            <p>${L('Echo.Count', { n: count })}</p><p class="hz-level">${L('Echo.LevelUp', { level: levelFor(count) })}</p>
            ${done ? `<p class="hz-alert">${L('Echo.AllCollected')}</p>` : ''}</div>`,
        speaker: { alias: L('Chat.Journey') }
    });
}

/** Direction of the nearest sanctuary still holding a Soul Echo (Locate Soul Echoes). */
export function nearestEcho(state, journey, from = state.party) {
    const here = parse(from);
    const left = Object.entries(state.sanctuaries).filter(([k, s]) => s.echo && !journey.collected.includes(k));
    if (!left.length) return { done: true, direction: compass(here, parse(state.horizon)), key: state.horizon };
    left.sort((a, b) => distance(here, parse(a[0])) - distance(here, parse(b[0])));
    const [k] = left[0];
    return { done: false, key: k, direction: compass(here, parse(k)), distance: distance(here, parse(k)) };
}

export async function locateEchoes(actor) {
    const scene = game.scenes.find(s => isHorizonScene(s) && partyToken(s)) ?? null;
    const state = scene ? readMap(scene) : null;
    if (!state) return ui.notifications.warn(L('Echo.NoMap'));
    const journey = readJourney(scene);
    const found = nearestEcho(state, journey);
    const dir = L(`Compass.${found.direction}`);
    const text = found.done ? L('Echo.LocateHorizon', { direction: dir }) : L('Echo.Locate', { direction: dir });
    await ChatMessage.create({
        content: `<div class="dh-horizon-chat echo"><h3><i class="fa-solid fa-compass"></i> ${L('Echo.LocateTitle')}</h3><p>${actor ? `<strong>${esc(actor.name)}</strong> ` : ''}${text}</p></div>`,
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: L('Chat.Journey') }
    });
    if (game.settings.get(MODULE_ID, 'seekersHear')) {
        await ChatMessage.create({ content: `<div class="dh-horizon-chat"><p><i class="fa-solid fa-ghost"></i> ${L('Echo.SeekersHear', { direction: dir })}</p></div>`, whisper: gmIds(), speaker: { alias: L('Chat.KeyMap') } });
    }
}

/* ------------------------------------------------------------------ */
/*  Party token hook                                                  */
/* ------------------------------------------------------------------ */

const busy = new Set();

/** When the party token moves on a Horizon scene, run the journey from the old hex to the new one. */
export function registerTravel() {
    Hooks.on('updateToken', async (token, changes, options) => {
        if (!game.user.isActiveGM) return;
        if (!('x' in changes || 'y' in changes)) return;
        if (!token.getFlag(MODULE_ID, 'party')) return;
        const scene = token.parent;
        if (!isHorizonScene(scene)) return;
        const state = readMap(scene);
        const to = tokenHex(token, changes);
        const toKey = key(to.c, to.r);
        const fromKey = state.party ?? state.start;
        if (toKey === fromKey) return;
        if (to.c < 0 || to.r < 1 || to.c >= state.cols || to.r > state.rows) return;
        if (busy.has(scene.id)) return;
        busy.add(scene.id);
        try {
            await travel(scene, fromKey, toKey, { silent: !!options?.[MODULE_ID]?.place });
        } catch (err) {
            console.error(`${MODULE_ID} | travel`, err);
            ui.notifications.error(err.message);
        } finally {
            busy.delete(scene.id);
            redrawOverlaySoon();
        }
    });
}
