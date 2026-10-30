// src/engine/actionChoices.js — SPEC v7 §4: encounters gain verbs.
// Pure module. Scribe's research/action-choices-v7.json marks up to 2 choices
// per encounter with { verb, item, requirement }. This module attaches those
// marks onto encounter objects and answers, per choice, whether the verb
// requirement is currently MET — unmet choices render greyed with the
// requirement text. Effects are UNCHANGED: action-choices only route through the
// verb system, resolve math stays in encounters.js/game.js.
//
// Verb → requirement mapping (the six legal verbs):
//   throw  — the named item in hand (stone/spear/torch); none = any thrown object
//   light  — torch in hand
//   sneak  — crouching
//   climb  — standing on/near a climbable prop (host passes nearClimbable) OR stamina > 0
//   pay    — enough coin/credit in the pocket (countables)
//   gather — hand free (a free hand is what gathering costs)

import { HELD_ITEMS } from './actions.js';

const PAY_AMOUNT = 5; // same contract as entities.PAY_ITEMS guards

/** Attach markup to world encounter objects. Mutates each object's choices with
 *  an `action` field where marked. Returns the number of marked choices. */
export function attachActionMarks(objects, markupDoc) {
  const byId = new Map(markupDoc.markups.map((m) => [m.id, m]));
  let marked = 0;
  for (const o of objects) {
    const m = byId.get(o.id);
    if (!m || !Array.isArray(o.choices)) continue;
    for (const mc of m.choices) {
      const target = o.choices.find((c) => c.label === mc.label);
      if (target && mc.action) { target.action = mc.action; marked++; }
    }
  }
  return marked;
}

/**
 * Is an action-marked choice currently available?
 * @param {object} action  { verb, item, requirement }
 * @param {object} ctx     { state, actions, nearClimbable?:bool }
 * @returns {{met:boolean, reason:string}} reason = requirement text when unmet.
 */
export function checkActionRequirement(action, ctx) {
  const { state, actions, nearClimbable = false } = ctx;
  const v7 = state.v7 || {};
  const held = v7.held ?? null;
  const req = action.requirement || '';
  switch (action.verb) {
    case 'throw':
      if (action.item === 'none') return { met: true, reason: '' };
      return held === action.item ? { met: true, reason: '' } : { met: false, reason: req };
    case 'light':
      return held === 'torch' ? { met: true, reason: '' } : { met: false, reason: req };
    case 'sneak':
      return actions.crouching ? { met: true, reason: '' } : { met: false, reason: req };
    case 'climb':
      return (nearClimbable || (v7.stamina ?? 0) > 0) ? { met: true, reason: '' } : { met: false, reason: req };
    case 'pay': {
      const key = action.item === 'credit' ? 'credit' : 'coin';
      const have = (v7.inventory || {})[key] || 0;
      return have >= PAY_AMOUNT ? { met: true, reason: '' } : { met: false, reason: req };
    }
    case 'gather':
      return held === null ? { met: true, reason: '' } : { met: false, reason: req };
    default:
      return { met: true, reason: '' }; // unknown verbs never grey out (fail open)
  }
}

/**
 * View-model for the menu renderer: same labels/effects, plus disabled+reason
 * on unmet action-choices. Plain choices pass through untouched.
 */
export function decorateChoices(choices, ctx) {
  return (choices || []).map((c) => {
    if (!c.action) return { ...c, disabled: false };
    const { met, reason } = checkActionRequirement(c.action, ctx);
    return { ...c, disabled: !met, requirement: met ? undefined : reason };
  });
}
