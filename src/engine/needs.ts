/**
 * Everdawn Vale — Agentopia-style needs (satisfaction 0..100).
 *
 * Four needs decay each game-minute while awake. Asleep, energy RECOVERS and
 * the other three keep decaying at a quarter rate (a sleeping villager still
 * wakes hungry, but not starving). urgent() drives deterministic plan
 * preemption: the need furthest below its urgency threshold wins.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { NeedId, Needs, NeedsApi, Rng } from '../types'
import {
  ENERGY_DECAY,
  ENERGY_RECOVER_ASLEEP,
  HUNGER_DECAY,
  NEED_START,
  NEED_URGENT,
  SOCIAL_DECAY,
  SPIRIT_DECAY,
} from '../constants'

/** Hunger/social/spirit decay at this fraction of their waking rate while asleep. */
const ASLEEP_DECAY_SCALE = 0.25

/** Starting jitter applied around NEED_START, per need. */
const START_JITTER = 6

/** Fixed evaluation order — keeps rng draws and urgency tie-breaks deterministic. */
const NEED_ORDER: readonly NeedId[] = ['energy', 'hunger', 'social', 'spirit']

function clamp01to100(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function createNeeds(rng: Rng): NeedsApi {
  // draw jitters in fixed order so a given rng state always yields the same start
  const energy = clamp01to100(NEED_START + rng.range(-START_JITTER, START_JITTER))
  const hunger = clamp01to100(NEED_START + rng.range(-START_JITTER, START_JITTER))
  const social = clamp01to100(NEED_START + rng.range(-START_JITTER, START_JITTER))
  const spirit = clamp01to100(NEED_START + rng.range(-START_JITTER, START_JITTER))
  const values: Needs = { energy, hunger, social, spirit }

  return {
    values,

    tickMinute(asleep: boolean): void {
      if (asleep) {
        values.energy = clamp01to100(values.energy + ENERGY_RECOVER_ASLEEP)
        values.hunger = clamp01to100(values.hunger - HUNGER_DECAY * ASLEEP_DECAY_SCALE)
        values.social = clamp01to100(values.social - SOCIAL_DECAY * ASLEEP_DECAY_SCALE)
        values.spirit = clamp01to100(values.spirit - SPIRIT_DECAY * ASLEEP_DECAY_SCALE)
      } else {
        values.energy = clamp01to100(values.energy - ENERGY_DECAY)
        values.hunger = clamp01to100(values.hunger - HUNGER_DECAY)
        values.social = clamp01to100(values.social - SOCIAL_DECAY)
        values.spirit = clamp01to100(values.spirit - SPIRIT_DECAY)
      }
    },

    satisfy(id: NeedId, amount: number): void {
      values[id] = clamp01to100(values[id] + amount)
    },

    urgent(): NeedId | null {
      let worst: NeedId | null = null
      let worstRatio = Infinity
      for (const id of NEED_ORDER) {
        const threshold = NEED_URGENT[id]
        const value = values[id]
        if (value >= threshold) continue
        const ratio = value / threshold
        if (ratio < worstRatio) {
          worstRatio = ratio
          worst = id
        }
      }
      return worst
    },
  }
}
