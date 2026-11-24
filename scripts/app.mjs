/**
 * The Journey to Horizon app: build the hex map, inspect and edit hexes (the GM's key map), run the
 * journey (river travel, rests, Soul Echoes) and keep the Doom Track. Players see the journey and
 * the boxes marked on the Doom Track.
 */
import { ART, HF_PAGES, L, MAX_SHORT_RESTS, MODULE_ID, esc, hasHF, tileSrc } from './constants.mjs';
import { addRegion, createMap, ensureRegions, ensureSanctuary, hexTile, newSeed, regionOf, rerollRegion, rollSanctuary, rng, rumorText, setHabitat } from './generator.mjs';
import { key, parse } from './hexmath.mjs';
import { createScene, drawOverlay, partyToken, placePartyToken, refreshBackground, selection, syncTiles } from './scene.mjs';
import { defaultDoom, emptyJourney, horizonScene, readDoom, readJourney, readMap, save, saveDoom } from './store.mjs';
import { ENCOUNTERS, HABITAT_KEYS, SANCTUARY_TABLES, TIERS } from './tables.mjs';
import { atSanctuary, collectEcho, echoCount, nearestEcho, partyLevel, partyTier, revealAround, takeRest, travel } from './travel.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class HorizonApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'dh-horizon-app',
        classes: ['dh-horizon'],
        window: { title: 'DHHZ.App.Title', icon: 'fa-solid fa-map-location-dot', resizable: true },
        position: { width: 720, height: 760 },
        actions: {
            hzTab: HorizonApp.#onTab,
            createMap: HorizonApp.#onCreateMap,
            randomSeed: HorizonApp.#onRandomSeed,
            prepareAll: HorizonApp.#onPrepareAll,
            repaint: HorizonApp.#onRepaint,
            viewScene: HorizonApp.#onViewScene,
            selectParty: HorizonApp.#onSelectParty,
            rerollRegion: HorizonApp.#onRerollRegion,
            newRegion: HorizonApp.#onNewRegion,
            toggleReveal: HorizonApp.#onToggleReveal,
            revealRegion: HorizonApp.#onRevealRegion,
            rollSanctuary: HorizonApp.#onRollSanctuary,
            toggleEcho: HorizonApp.#onToggleEcho,
            toggleSanctuary: HorizonApp.#onToggleSanctuary,
            collectEcho: HorizonApp.#onCollectEcho,
            moveParty: HorizonApp.#onMoveParty,
            rest: HorizonApp.#onRest,
            locate: HorizonApp.#onLocate,
            markDoom: HorizonApp.#onMarkDoom,
            addDoom: HorizonApp.#onAddDoom,
            removeDoom: HorizonApp.#onRemoveDoom,
            resetDoom: HorizonApp.#onResetDoom,
            endSession: HorizonApp.#onEndSession,
            openRules: HorizonApp.#onOpenRules
        }
    };

    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/horizon.hbs`, scrollable: ['.hz-scroll'] } };

    tab = null;
    draft = { cols: 36, rows: 24, sanctuaries: 40, seed: newSeed(), name: '' };

    get scene() {
        return horizonScene();
    }

    async _prepareContext() {
        const gm = game.user.isGM;
        const scene = this.scene;
        const state = scene ? readMap(scene) : null;
        const journey = scene ? readJourney(scene) : emptyJourney();
        this.tab ??= gm ? (state ? 'hex' : 'map') : 'journey';
        if (!gm && (this.tab === 'map' || this.tab === 'hex')) this.tab = 'journey';
        if (gm && state && !selection.hex) selection.hex = state.party;

        const tabs = [
            gm && { id: 'map', icon: 'fa-solid fa-earth-americas', label: L('App.Tab.Map') },
            gm && state && { id: 'hex', icon: 'fa-solid fa-hexagon', label: L('App.Tab.Hex') },
            { id: 'journey', icon: 'fa-solid fa-route', label: L('App.Tab.Journey') },
            { id: 'doom', icon: 'fa-solid fa-hourglass-half', label: L('App.Tab.Doom') }
        ]
            .filter(Boolean)
            .map(t => ({ ...t, active: t.id === this.tab }));

        return {
            gm,
            tab: this.tab,
            tabs,
            art: hasHF() ? ART.intro : null,
            hasHF: hasHF(),
            hasScene: !!scene,
            sceneName: scene?.name,
            draft: this.draft,
            map: state ? this.#mapContext(state, journey) : null,
            hex: gm && state ? this.#hexContext(state, journey) : null,
            journey: state ? this.#journeyContext(state, journey) : null,
            doom: this.#doomContext(state, journey)
        };
    }

    #mapContext(state, journey) {
        const regions = Object.values(state.regions);
        const land = Object.keys(state.land).length;
        const rolled = Object.keys(state.hexes).filter(k => state.hexes[k].region).length;
        return {
            cols: state.cols,
            rows: state.rows,
            seed: state.seed,
            land,
            rolled,
            regions: regions.length,
            revealed: Object.values(state.hexes).filter(h => h.revealed).length,
            sanctuaries: Object.keys(state.sanctuaries).length,
            echoes: Object.values(state.sanctuaries).filter(s => s.echo).length,
            percent: land ? Math.round((rolled / land) * 100) : 0
        };
    }

    #hexContext(state, journey) {
        const k = selection.hex ?? state.party;
        const { c, r } = parse(k);
        const hex = state.hexes[k] ?? {};
        const region = regionOf(state, k);
        const s = state.sanctuaries[k];
        const sel = (list, value, label) => list.map(v => ({ value: v, label: label(v), selected: String(v) === String(value) }));
        const ctx = {
            key: k,
            coords: `${c}, ${r}`,
            land: !!state.land[k],
            tile: tileSrc(hexTile(state, k)),
            revealed: !!hex.revealed,
            isParty: state.party === k,
            region: null,
            sanctuary: null
        };
        if (region) {
            ctx.region = {
                id: region.id,
                size: region.hexes.length,
                rolled: region.size,
                habitat: region.habitat,
                habitats: sel(HABITAT_KEYS, region.habitat, h => L(`Habitat.${h}.Name`)),
                habitatHint: L(`Habitat.${region.habitat}.Hint`),
                blighted: region.blighted,
                overtaken: region.overtaken,
                terrain: region.terrain,
                terrains: sel([1, 2, 3, 4], region.terrain, t => `${t} · ${L(`Terrain.${t}.Name`)}`),
                terrainHint: L(`Terrain.${region.terrain}.Hint`),
                encounter: region.encounter,
                encounters: sel(ENCOUNTERS, region.encounter, n => `${n} · ${L(`Encounter.${n}`)}`.slice(0, 90)),
                encounterText: L(`Encounter.${region.encounter}`),
                encounterUsed: region.encounterUsed,
                encounterDie: region.encounterDie,
                dice: sel([4, 6, 8], region.encounterDie, d => `d${d}`),
                rumor: region.rumor,
                rumorText: rumorText(region.rumor),
                rumorKnown: region.rumorKnown,
                notes: region.notes,
                spells: (HABITAT_SPELLS[region.habitat] ?? []).map(sp => L(`Spell.${sp}`)).join(', ')
            };
        }
        if (s) {
            const rolls = s.rolls;
            ctx.sanctuary = {
                name: s.name,
                fixed: s.fixed,
                echo: !!s.echo,
                collected: journey.collected.includes(k) || s.fixed === 'start',
                canCollect: !!s.echo && state.party === k && !journey.collected.includes(k),
                notes: s.notes,
                rows: rolls
                    ? Object.keys(SANCTUARY_TABLES).map(t => ({
                          table: t,
                          label: L(`Sanctuary.Table.${t}`),
                          die: `d${SANCTUARY_TABLES[t]}`,
                          value: rolls[t],
                          text: t === 'politics' && rolls.politicsMix ? rolls.politicsMix.map(v => L(`Sanctuary.politics.${v}`)).join(' + ') : L(`Sanctuary.${t}.${rolls[t]}`)
                      }))
                    : null
            };
        }
        return ctx;
    }

    #journeyContext(state, journey) {
        const here = state.party;
        const region = regionOf(state, here);
        const s = state.sanctuaries[here];
        const echoes = echoCount(state, journey);
        const level = partyLevel(state, journey);
        const gm = game.user.isGM;
        const near = gm ? nearestEcho(state, journey) : null;
        return {
            where: s ? s.name : region ? L(`Habitat.${region.habitat}.Name`) : '—',
            tile: tileSrc(hexTile(state, here)),
            terrain: region ? L(`Terrain.${region.terrain}.Name`) : '',
            atSanctuary: atSanctuary(state),
            days: journey.days,
            shortRests: journey.shortRests,
            maxShort: MAX_SHORT_RESTS,
            restPips: Array.from({ length: MAX_SHORT_RESTS }, (_, i) => i < journey.shortRests),
            canShort: journey.shortRests < MAX_SHORT_RESTS,
            echoes,
            echoPips: Array.from({ length: 10 }, (_, i) => i < echoes),
            level,
            tier: partyTier(state, journey),
            modes: ['foot', 'downstream', 'upstream'].map(m => ({ value: m, label: L(`Mode.${m}`), selected: journey.mode === m })),
            hexes: (journey.path ?? []).length,
            nearest: near && !near.done ? L('Journey.NearestEcho', { name: state.sanctuaries[near.key]?.name, distance: near.distance, direction: L(`Compass.${near.direction}`) }) : null,
            endurance: game.settings.get(MODULE_ID, 'endurance'),
            log: (journey.log ?? [])
                .slice(-12)
                .reverse()
                .map(e => ({
                    place: state.sanctuaries[e.to]?.name ?? (e.habitat ? L(`Habitat.${e.habitat}.Name`) : '?'),
                    days: e.days,
                    total: e.total,
                    encounter: gm && e.encounter ? e.encounter.join(' + ') : null,
                    mode: e.mode && e.mode !== 'foot' ? L(`Mode.${e.mode}`) : null
                }))
        };
    }

    #doomContext(state, journey) {
        const doom = readDoom();
        const gm = game.user.isGM;
        const tier = state ? partyTier(state, journey) : 1;
        const showAll = gm || game.settings.get(MODULE_ID, 'doomPublic') === 'all';
        const map = (box, tierN, parentMarked) => ({
            id: box.id,
            text: box.text,
            marked: box.marked,
            visible: showAll || box.marked,
            canMark: gm && !box.marked && tierN <= tier && parentMarked,
            canUnmark: gm && box.marked && !(box.children ?? []).some(ch => ch.marked),
            children: (box.children ?? []).map(ch => map(ch, tierN, box.marked))
        });
        return {
            tier,
            tiers: TIERS.map(n => ({
                n,
                current: n === tier,
                locked: n > tier,
                boxes: (doom.tiers[n] ?? []).map(b => map(b, n, true))
            })),
            marked: doom.log.length,
            last: doom.log.slice(-3).reverse()
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        el.classList.toggle('hz-gm', game.user.isGM);
        // inputs that edit the key map
        for (const input of el.querySelectorAll('[data-edit]')) input.addEventListener('change', ev => this.#onEdit(ev));
        for (const input of el.querySelectorAll('[data-draft]')) {
            input.addEventListener('change', ev => {
                const f = ev.currentTarget.dataset.draft;
                this.draft[f] = ev.currentTarget.type === 'number' ? Number(ev.currentTarget.value) : ev.currentTarget.value;
            });
        }
        for (const input of el.querySelectorAll('[data-doom-text]')) input.addEventListener('change', ev => this.#onDoomText(ev));
        el.querySelector('[data-journey="mode"]')?.addEventListener('change', async ev => {
            const scene = this.scene;
            const journey = readJourney(scene);
            journey.mode = ev.currentTarget.value;
            await save(scene, { journey });
        });
    }

    /* -------------------------------------------- */
    /*  Editing the key map                         */
    /* -------------------------------------------- */

    async #onEdit(ev) {
        const scene = this.scene;
        const state = readMap(scene);
        const k = selection.hex;
        const field = ev.currentTarget.dataset.edit;
        const raw = ev.currentTarget.type === 'checkbox' ? ev.currentTarget.checked : ev.currentTarget.value;
        const region = regionOf(state, k);
        const s = state.sanctuaries[k];
        let tiles = false;
        let repaint = false;
        switch (field) {
            case 'habitat':
                setHabitat(state, region.id, raw);
                tiles = true;
                break;
            case 'blighted':
                region.blighted = !!raw;
                tiles = true;
                break;
            case 'terrain':
            case 'encounter':
            case 'encounterDie':
            case 'rumor':
                region[field] = Math.max(1, Math.min(field === 'rumor' ? 100 : 99, Number(raw) || 1));
                break;
            case 'encounterUsed':
                region.encounterUsed = !!raw;
                break;
            case 'notes':
                region.notes = String(raw);
                break;
            case 'sanctuaryName':
                s.name = String(raw).trim() || s.name;
                break;
            case 'sanctuaryNotes':
                s.notes = String(raw);
                break;
            default:
                return;
        }
        await save(scene, { map: state });
        if (tiles) await syncTiles(scene);
        if (repaint) await refreshBackground(scene);
    }

    /* -------------------------------------------- */
    /*  Actions                                     */
    /* -------------------------------------------- */

    static #onTab(ev, target) {
        this.tab = target.dataset.tab;
        this.render();
    }

    static #onRandomSeed() {
        this.draft.seed = newSeed();
        this.render();
    }

    static async #onCreateMap(ev, target) {
        const d = this.draft;
        const existing = this.scene;
        if (existing) {
            const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: L('Map.New') }, content: `<p>${L('Map.NewConfirm')}</p>` });
            if (!ok) return;
        }
        target.disabled = true;
        ui.notifications.info(L('Map.Building'));
        try {
            const state = createMap({
                cols: Math.max(12, Math.min(80, d.cols)),
                rows: Math.max(10, Math.min(60, d.rows)),
                sanctuaries: Math.max(10, Math.min(120, d.sanctuaries)),
                seed: Number(d.seed) || newSeed(),
                names: { start: L('Map.Marrogate'), horizon: L('Map.Horizon') }
            });
            revealAround(state, state.start);
            const journey = emptyJourney();
            journey.path = [state.start];
            const scene = await createScene(state, journey, d.name?.trim() || L('Map.SceneName'));
            await syncTiles(scene);
            await placePartyToken(scene, state.start);
            await scene.view();
            selection.hex = state.start;
            this.draft.seed = newSeed();
            this.tab = 'hex';
            ui.notifications.info(L('Map.Built', { name: scene.name }));
        } catch (err) {
            console.error(err);
            ui.notifications.error(err.message);
        } finally {
            this.render();
        }
    }

    static async #onPrepareAll(ev, target) {
        const scene = this.scene;
        const state = readMap(scene);
        target.disabled = true;
        ensureRegions(state, Object.keys(state.land));
        for (const k of Object.keys(state.sanctuaries)) ensureSanctuary(state, k);
        await save(scene, { map: state });
        await syncTiles(scene);
        this.render();
    }

    static async #onRepaint() {
        await refreshBackground(this.scene);
        await syncTiles(this.scene);
    }

    static #onViewScene() {
        this.scene?.view();
    }

    static #onSelectParty() {
        const state = readMap(this.scene);
        selection.hex = state.party;
        drawOverlay();
        this.render();
    }

    static async #onRerollRegion() {
        const scene = this.scene;
        const state = readMap(scene);
        const region = regionOf(state, selection.hex);
        if (!region) return;
        rerollRegion(state, region.id);
        await save(scene, { map: state });
        await syncTiles(scene);
    }

    static async #onNewRegion() {
        const scene = this.scene;
        const state = readMap(scene);
        const k = selection.hex;
        if (!state.land[k]) return;
        const old = regionOf(state, k);
        if (old) {
            old.hexes = old.hexes.filter(h => h !== k);
            delete state.hexes[k].region;
            if (!old.hexes.length) delete state.regions[old.id];
        }
        addRegion(state, k);
        await save(scene, { map: state });
        await syncTiles(scene);
    }

    static async #onToggleReveal() {
        const scene = this.scene;
        const state = readMap(scene);
        const k = selection.hex;
        if (!state.land[k]) return;
        ensureRegions(state, [k]);
        state.hexes[k].revealed = !state.hexes[k].revealed;
        await save(scene, { map: state });
        await syncTiles(scene);
    }

    static async #onRevealRegion() {
        const scene = this.scene;
        const state = readMap(scene);
        const region = regionOf(state, selection.hex);
        if (!region) return;
        const hide = region.hexes.every(k => state.hexes[k]?.revealed);
        for (const k of region.hexes) state.hexes[k].revealed = !hide;
        await save(scene, { map: state });
        await syncTiles(scene);
    }

    static async #onRollSanctuary() {
        const scene = this.scene;
        const state = readMap(scene);
        const s = state.sanctuaries[selection.hex];
        if (!s || s.fixed) return;
        const random = rng(state.rng || state.seed);
        Object.assign(s, rollSanctuary(random, { name: s.name, echo: s.echo, notes: s.notes }));
        state.rng = random.state();
        await save(scene, { map: state });
        await syncTiles(scene);
    }

    static async #onToggleEcho() {
        const scene = this.scene;
        const state = readMap(scene);
        const s = state.sanctuaries[selection.hex];
        if (!s || s.fixed) return;
        s.echo = !s.echo;
        await save(scene, { map: state });
    }

    static async #onToggleSanctuary() {
        const scene = this.scene;
        const state = readMap(scene);
        const k = selection.hex;
        if (!state.land[k]) return;
        if (state.sanctuaries[k]) {
            if (state.sanctuaries[k].fixed) return;
            delete state.sanctuaries[k];
        } else {
            const random = rng(state.rng || state.seed);
            state.sanctuaries[k] = rollSanctuary(random);
            state.rng = random.state();
        }
        await save(scene, { map: state });
        await refreshBackground(scene);
        await syncTiles(scene);
    }

    static async #onCollectEcho() {
        await collectEcho(this.scene, selection.hex);
    }

    /** Move the party token to the selected hex: travel (with all rolls) or place it silently. */
    static async #onMoveParty(ev, target) {
        const scene = this.scene;
        const state = readMap(scene);
        const k = selection.hex;
        const silent = target.dataset.silent === 'true';
        const token = partyToken(scene);
        if (!token) {
            await placePartyToken(scene, k);
            await travel(scene, state.party, k, { silent: true });
            return;
        }
        const { x, y } = scene.grid.getTopLeftPoint({ i: parse(k).r, j: parse(k).c });
        await token.update({ x, y }, { [MODULE_ID]: { place: silent } });
    }

    static async #onRest(ev, target) {
        await takeRest(this.scene, target.dataset.kind);
    }

    static async #onLocate() {
        const { locateEchoes } = await import('./travel.mjs');
        await locateEchoes(game.user.character ?? null);
    }

    /* -------------------------------------------- */
    /*  Doom Track                                  */
    /* -------------------------------------------- */

    static #find(doom, id) {
        for (const tier of Object.keys(doom.tiers)) {
            const walk = (list, parent) => {
                for (const box of list) {
                    if (box.id === id) return { box, list, parent, tier: Number(tier) };
                    const found = walk(box.children ?? [], box);
                    if (found) return found;
                }
                return null;
            };
            const found = walk(doom.tiers[tier], null);
            if (found) return found;
        }
        return null;
    }

    static async #onMarkDoom(ev, target) {
        const doom = readDoom();
        const found = HorizonApp.#find(doom, target.dataset.id);
        if (!found) return;
        const scene = this.scene;
        const state = scene ? readMap(scene) : null;
        const tier = state ? partyTier(state, readJourney(scene)) : 1;
        const { box, parent } = found;
        if (!box.marked) {
            if (found.tier > tier) return ui.notifications.warn(L('Doom.TooHigh'));
            if (parent && !parent.marked) return ui.notifications.warn(L('Doom.NestedFirst'));
            box.marked = true;
            const session = scene ? readJourney(scene).session : null;
            doom.log.push({ at: Date.now(), id: box.id, text: box.text, session });
            await saveDoom(doom);
            await ChatMessage.create({
                content: `<div class="dh-horizon-chat doom"><h3><i class="fa-solid fa-hourglass-half"></i> ${L('Doom.Marked')}</h3><p>${esc(box.text)}</p></div>`,
                whisper: game.settings.get(MODULE_ID, 'doomPublic') === 'none' ? game.users.filter(u => u.isGM).map(u => u.id) : [],
                speaker: { alias: L('Doom.Title') }
            });
        } else {
            if ((box.children ?? []).some(ch => ch.marked)) return;
            box.marked = false;
            doom.log = doom.log.filter(e => e.id !== box.id);
            await saveDoom(doom);
        }
    }

    static async #onAddDoom(ev, target) {
        const doom = readDoom();
        const box = { id: foundry.utils.randomID(8), text: L('Doom.NewEvent'), marked: false, children: [] };
        if (target.dataset.parent) {
            const found = HorizonApp.#find(doom, target.dataset.parent);
            if (!found) return;
            found.box.children = [...(found.box.children ?? []), box];
        } else {
            doom.tiers[target.dataset.tier] = [...(doom.tiers[target.dataset.tier] ?? []), box];
        }
        await saveDoom(doom);
    }

    static async #onRemoveDoom(ev, target) {
        const doom = readDoom();
        const found = HorizonApp.#find(doom, target.dataset.id);
        if (!found) return;
        found.list.splice(found.list.indexOf(found.box), 1);
        await saveDoom(doom);
    }

    static async #onResetDoom() {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: L('Doom.Reset') }, content: `<p>${L('Doom.ResetConfirm')}</p>` });
        if (ok) await saveDoom(defaultDoom());
    }

    async #onDoomText(ev) {
        const doom = readDoom();
        const found = HorizonApp.#find(doom, ev.currentTarget.dataset.doomText);
        if (!found) return;
        found.box.text = ev.currentTarget.value;
        await saveDoom(doom);
    }

    /** End of session: count the session and point at the boxes the GM may mark. */
    static async #onEndSession() {
        const scene = this.scene;
        if (scene) {
            const journey = readJourney(scene);
            journey.session = (journey.session ?? 1) + 1;
            await save(scene, { journey });
        }
        this.tab = 'doom';
        this.render();
        ui.notifications.info(L('Doom.EndSessionHint'));
    }

    static #onOpenRules(ev, target) {
        const uuid = HF_PAGES[target.dataset.page];
        if (uuid) fromUuid(uuid).then(page => page?.parent?.sheet.render(true, { pageId: page.id }));
    }
}

/** Terranamancer effects that fit each habitat (see "Campaign Adversaries"). */
const HABITAT_SPELLS = {
    underground: ['stone'],
    aquatic: ['water'],
    wetland: ['poison'],
    grassland: ['wind'],
    tropical: ['overgrowth'],
    forest: ['overgrowth'],
    drylands: ['heat', 'stone'],
    rolling: ['wind', 'poison'],
    mountain: ['stone', 'ice'],
    frozen: ['ice'],
    badlands: ['heat', 'stone']
};

/** GM: Alt-click a hex on the Horizon scene to inspect it. */
export function registerHexPicker(getApp) {
    Hooks.on('canvasReady', () => {
        if (!game.user.isGM) return;
        canvas.stage.off('pointerdown', onPointer);
        canvas.stage.on('pointerdown', onPointer);
    });
    function onPointer(event) {
        if (!event.altKey || !game.user.isGM) return;
        const scene = canvas.scene;
        if (!scene?.getFlag(MODULE_ID, 'map')) return;
        const p = event.getLocalPosition(canvas.stage);
        const { i, j } = canvas.grid.getOffset(p);
        const state = readMap(scene);
        if (j < 0 || i < 1 || j >= state.cols || i > state.rows) return;
        selection.hex = key(j, i);
        drawOverlay();
        const app = getApp();
        app.tab = 'hex';
        app.render({ force: true });
    }
}
