/**
 * The special downtime move of Journey to Horizon, "Locate Soul Echoes", added to the system's
 * rest dialog, plus the campaign's resting limits shown in that dialog:
 * long rests only in a sanctuary, and no more than three short rests in a row.
 */
import { L, LOCATE_MARK, LOCATE_MOVE, MAX_SHORT_RESTS, MODULE_ID } from './constants.mjs';
import { partyToken } from './scene.mjs';
import { isHorizonScene, readJourney, readMap } from './store.mjs';
import { atSanctuary, locateEchoes } from './travel.mjs';

/** The character of the rest dialog most recently opened here (its chat card has no actor speaker). */
let lastActor = null;

function locateMove() {
    return {
        name: L('Downtime.Locate.Name'),
        icon: 'fa-solid fa-compass',
        img: 'icons/magic/light/orb-lightbulb-gray.webp',
        description: `<p ${LOCATE_MARK}>${L('Downtime.Locate.Description')}</p>`,
        actions: [],
        effects: []
    };
}

function horizonState() {
    const scene = game.scenes.find(s => isHorizonScene(s) && partyToken(s));
    return scene ? { state: readMap(scene), journey: readJourney(scene) } : null;
}

export function registerDowntime() {
    const Downtime = game.system.api?.applications?.dialogs?.Downtime;
    if (!Downtime) return;
    const original = Downtime.prototype._prepareContext;
    Downtime.prototype._prepareContext = async function (options) {
        lastActor = this.actor;
        if (game.settings.get(MODULE_ID, 'locateMove')) {
            for (const cat of ['shortRest', 'longRest']) {
                const moves = this.moveData?.[cat]?.moves;
                if (moves && !moves[LOCATE_MOVE]) moves[LOCATE_MOVE] = locateMove();
            }
        }
        const context = await original.call(this, options);
        context.dhhzWarning = restWarning(this.shortRest);
        return context;
    };

    Hooks.on('renderDhpDowntime', (app, html) => {
        const root = html instanceof HTMLElement ? html : html[0];
        const warning = restWarning(app.shortRest);
        if (!root || !warning || root.querySelector('.dh-horizon-rest-warning')) return;
        const div = document.createElement('div');
        div.className = 'dh-horizon-rest-warning';
        div.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${warning}`;
        root.querySelector('.window-content')?.prepend(div) ?? root.prepend(div);
    });

    // The chat card of a rest that included the move: tell the table where the next Echo calls from.
    Hooks.on('createChatMessage', message => {
        if (message.author?.id !== game.user.id) return;
        if (!String(message.content ?? '').includes(LOCATE_MARK)) return;
        const actor = ChatMessage.getSpeakerActor(message.speaker) ?? lastActor ?? game.user.character;
        locateEchoes(actor).catch(err => console.error(`${MODULE_ID} | locate`, err));
    });
}

function restWarning(shortRest) {
    if (!game.settings.get(MODULE_ID, 'restLimits')) return null;
    const h = horizonState();
    if (!h) return null;
    if (shortRest && h.journey.shortRests >= MAX_SHORT_RESTS) return L('Rest.NeedLong');
    if (!shortRest && !atSanctuary(h.state)) return L('Rest.LongOnlySanctuary');
    return null;
}
