/**
 * Conditions of the Terranamancer spells: Frostbitten (−1 Proficiency until the PC spends a Hope)
 * and Nauseated (can't gain Hope until the PC clears a HP), with the clearing rules automated.
 */
import { CONDITION, L, MODULE_ID } from './constants.mjs';

export const CONDITION_ICONS = {
    [CONDITION.frostbitten]: 'icons/magic/water/snowflake-ice-blue-white.webp',
    [CONDITION.nauseated]: 'icons/magic/unholy/orb-smoking-green.webp'
};

export const frostbittenChanges = () => [{ key: 'system.proficiency', type: 'add', value: -1, phase: 'initial', priority: null }];

/** Runs in "setup", after the system sets its own conditions. */
export function registerConditions() {
    if (!game.settings.get(MODULE_ID, 'conditions')) return;
    CONFIG.statusEffects.push(
        {
            id: CONDITION.frostbitten,
            _id: 'dhhzFrostbitten0',
            name: L('Condition.frostbitten.Name'),
            img: CONDITION_ICONS[CONDITION.frostbitten],
            description: L('Condition.frostbitten.Short'),
            system: { changes: frostbittenChanges() }
        },
        {
            id: CONDITION.nauseated,
            _id: 'dhhzNauseated000',
            name: L('Condition.nauseated.Name'),
            img: CONDITION_ICONS[CONDITION.nauseated],
            description: L('Condition.nauseated.Short')
        }
    );
}

const has = (actor, id) => actor?.statuses?.has(id) || actor?.items?.some(i => i.getFlag(MODULE_ID, 'condition') === id);

async function clear(actor, id) {
    const effects = actor.effects.filter(e => e.statuses?.has(id)).map(e => e.id);
    const items = actor.items.filter(i => i.getFlag(MODULE_ID, 'condition') === id).map(i => i.id);
    if (effects.length) await actor.deleteEmbeddedDocuments('ActiveEffect', effects);
    if (items.length) await actor.deleteEmbeddedDocuments('Item', items);
    if (effects.length || items.length) ui.notifications.info(L('Condition.Cleared', { name: actor.name, condition: L(`Condition.${id}.Name`) }));
}

export function registerConditionRules() {
    // Nauseated: no Hope gained.
    Hooks.on('preUpdateActor', (actor, changes) => {
        const hope = foundry.utils.getProperty(changes, 'system.resources.hope.value');
        if (hope == null || !has(actor, CONDITION.nauseated)) return;
        if (hope > (actor.system.resources?.hope?.value ?? 0)) {
            foundry.utils.setProperty(changes, 'system.resources.hope.value', actor.system.resources.hope.value);
            ui.notifications.info(L('Condition.nauseated.Blocked', { name: actor.name }));
        }
    });
    // Remember the values before the update so we can tell what happened.
    Hooks.on('preUpdateActor', (actor, changes, options) => {
        options[MODULE_ID] = { hope: actor.system.resources?.hope?.value, hp: actor.system.resources?.hitPoints?.value };
    });
    Hooks.on('updateActor', (actor, changes, options, userId) => {
        if (userId !== game.user.id) return;
        const before = options[MODULE_ID];
        if (!before) return;
        const hope = foundry.utils.getProperty(changes, 'system.resources.hope.value');
        const hp = foundry.utils.getProperty(changes, 'system.resources.hitPoints.value');
        if (hope != null && hope < before.hope && has(actor, CONDITION.frostbitten)) clear(actor, CONDITION.frostbitten);
        if (hp != null && hp < before.hp && has(actor, CONDITION.nauseated)) clear(actor, CONDITION.nauseated);
    });
}
