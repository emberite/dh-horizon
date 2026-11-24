import { HF_ID, L, MODULE_ID } from './constants.mjs';
import { HorizonApp, registerHexPicker } from './app.mjs';
import { registerConditionRules, registerConditions } from './conditions.mjs';
import { registerDowntime } from './downtime.mjs';
import { clearOverlay, drawOverlay, redrawOverlaySoon, syncTiles } from './scene.mjs';
import { horizonScene, isHorizonScene, readJourney, readMap } from './store.mjs';
import { collectEcho, locateEchoes, onCardButton, registerTravel, takeRest, travel } from './travel.mjs';
import * as generator from './generator.mjs';

let app = null;

/** Open (or focus) the Journey to Horizon app on this client. */
export function open(tab) {
    app ??= new HorizonApp();
    if (tab) app.tab = tab;
    app.render({ force: true });
    return app;
}

/**
 * Load the stylesheet with a version query. Foundry links module CSS by bare path, and a caching
 * proxy would otherwise keep serving last release's styles. Same cascade layer Foundry uses for module styles.
 */
function loadStyles() {
    const version = game.modules.get(MODULE_ID)?.version ?? Date.now();
    const style = document.createElement('style');
    style.id = `${MODULE_ID}-styles`;
    style.textContent = `@import url("modules/${MODULE_ID}/styles/horizon.css?v=${encodeURIComponent(version)}") layer(modules);`;
    document.head.append(style);
}

function registerSettings() {
    const world = (k, type, def, extra = {}) =>
        game.settings.register(MODULE_ID, k, { name: `DHHZ.Settings.${k}.Name`, hint: `DHHZ.Settings.${k}.Hint`, scope: 'world', config: true, type, default: def, ...extra });
    world('prepRadius', Number, 2, { range: { min: 1, max: 6, step: 1 } });
    world('blindEncounters', Boolean, true);
    world('endurance', Boolean, false);
    world('restLimits', Boolean, true);
    world('locateMove', Boolean, true);
    world('seekersHear', Boolean, true);
    world('showNames', Boolean, true);
    world('doomPublic', String, 'marked', { choices: { none: 'DHHZ.Settings.doomPublic.none', marked: 'DHHZ.Settings.doomPublic.marked', all: 'DHHZ.Settings.doomPublic.all' } });
    world('conditions', Boolean, true, { requiresReload: true });
    game.settings.register(MODULE_ID, 'gmKey', {
        name: 'DHHZ.Settings.gmKey.Name',
        hint: 'DHHZ.Settings.gmKey.Hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true,
        onChange: () => redrawOverlaySoon()
    });
    game.settings.register(MODULE_ID, 'doom', { scope: 'world', config: false, type: Object, default: {} });
}

Hooks.once('init', () => {
    loadStyles();
    registerSettings();
    foundry.applications.handlebars.loadTemplates({ 'dhhz-doom-box': `modules/${MODULE_ID}/templates/doom-box.hbs` });
    game.modules.get(MODULE_ID).api = {
        open,
        travel: (to, opts) => {
            const scene = horizonScene();
            const state = readMap(scene);
            return travel(scene, state.party, to, opts);
        },
        rest: kind => takeRest(horizonScene(), kind),
        collectEcho: k => collectEcho(horizonScene(), k),
        locateEchoes,
        map: () => readMap(),
        journey: () => readJourney(),
        syncTiles: () => syncTiles(horizonScene()),
        generator
    };
});

// The system sets its conditions in "setup"; ours go after them.
Hooks.once('setup', () => registerConditions());

Hooks.once('ready', () => {
    registerTravel();
    registerDowntime();
    registerConditionRules();
    registerHexPicker(() => app ?? open());
    registerVessel();
    if (game.user.isGM && !game.modules.get(HF_ID)?.active) ui.notifications.warn(L('Notify.NoHopeAndFear'), { permanent: true });
    if (canvas.ready) drawOverlay();
});

/* ------------------------------------------------------------------ */
/*  Keeping the map and the app up to date                            */
/* ------------------------------------------------------------------ */

Hooks.on('canvasReady', () => drawOverlay());
Hooks.on('canvasTearDown', () => clearOverlay());
Hooks.on('updateScene', (scene, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    if (scene.id === canvas.scene?.id) redrawOverlaySoon();
    if (app?.rendered) app.render();
});
Hooks.on('updateSetting', setting => {
    if (setting.key === `${MODULE_ID}.doom` && app?.rendered) app.render();
});
Hooks.on('deleteScene', () => app?.rendered && app.render());

/* ------------------------------------------------------------------ */
/*  Chat cards                                                        */
/* ------------------------------------------------------------------ */

Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!message.getFlag(MODULE_ID, 'card')) return;
    for (const btn of html.querySelectorAll('[data-hz]')) {
        if (!game.user.isGM) {
            btn.remove();
            continue;
        }
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            btn.disabled = true;
            onCardButton(message, btn.dataset.hz).finally(() => (btn.disabled = false));
        });
    }
});

/* ------------------------------------------------------------------ */
/*  The Vessel of Light                                               */
/* ------------------------------------------------------------------ */

/** Using the Vessel of Light's "Locate Soul Echoes" action asks the Echoes for the way. */
function registerVessel() {
    Hooks.on('daggerheart.postUseAction', action => {
        const flag = action?.item?.getFlag?.(MODULE_ID, 'vessel');
        if (!flag || (flag.action && flag.action !== (action.id ?? action._id))) return;
        locateEchoes(action.actor ?? null).catch(err => ui.notifications.error(err.message));
    });
}

/* ------------------------------------------------------------------ */
/*  Where to open the app                                             */
/* ------------------------------------------------------------------ */

/** "Journey to Horizon" section in the Daggerheart sidebar menu. */
Hooks.on('renderDaggerheartMenu', (menu, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.querySelector('.dh-horizon-menu')) return;
    const fieldsets = root.querySelectorAll('fieldset');
    const last = fieldsets[fieldsets.length - 1];
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'dh-horizon-menu';
    fieldset.innerHTML = `
        <legend>${L('Menu.Legend')}</legend>
        <div class="menu-options-container">
            <div class="menu-options-inner-container">
                ${game.user.isGM ? `<button type="button" data-hz-open="map"><i class="fa-solid fa-map-location-dot"></i> ${L('Menu.Map')}</button>` : ''}
                <button type="button" data-hz-open="journey"><i class="fa-solid fa-route"></i> ${L('Menu.Journey')}</button>
                <button type="button" data-hz-open="doom"><i class="fa-solid fa-hourglass-half"></i> ${L('Menu.Doom')}</button>
            </div>
        </div>`;
    for (const btn of fieldset.querySelectorAll('[data-hz-open]')) btn.addEventListener('click', () => open(btn.dataset.hzOpen));
    if (last) last.after(fieldset);
    else root.append(fieldset);
});

/** A button in the token controls while a Horizon scene is on the canvas. */
Hooks.on('getSceneControlButtons', controls => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools || !isHorizonScene(canvas.scene)) return;
    tokens.tools.dhhzHorizon = {
        name: 'dhhzHorizon',
        title: 'DHHZ.App.Title',
        icon: 'fa-solid fa-map-location-dot',
        order: 50,
        button: true,
        onChange: () => open(game.user.isGM ? 'hex' : 'journey')
    };
});
