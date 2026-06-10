/**
 * Brain tests — LLM-first with per-call LocalBrain fallback, driven entirely
 * by stub transports (the network is NEVER touched).
 */
import { describe, expect, it } from 'vitest'
import type {
  ConverseResult,
  EventBus,
  GameTime,
  LlmTransport,
  MemoryRecord,
  Persona,
} from '../src/types'
import { AFFECTION_CLAMP, FESTIVAL_END_MIN, FESTIVAL_START_MIN } from '../src/constants'
import { createRng } from '../src/engine/rng'
import { PLACES } from '../src/data/places'
import { PERSONAS } from '../src/data/agents'
import { createBrain } from '../src/llm/brain'
import {
  localChatReply,
  localConverse,
  localPlan,
  localReflect,
} from '../src/llm/localBrain'

const seraphine = PERSONAS.find((p) => p.id === 'seraphine')!
const thorin = PERSONAS.find((p) => p.id === 'thorin')!

const T: GameTime = { day: 1, hour: 10, minute: 0, totalMin: 600 }

function mem(id: number, text: string): MemoryRecord {
  return { id, kind: 'seed', text, createdMin: 0, lastAccessMin: 0, importance: 5, subjects: [] }
}

/** Transport stub resolving a fixed text (null = failure) for every call. */
function stub(reply: string | null): LlmTransport {
  return { complete: async () => reply }
}

/** Minimal recording bus — only emissions matter to the Brain. */
function recordingBus(): { bus: EventBus; statuses: boolean[] } {
  const statuses: boolean[] = []
  const bus: EventBus = {
    on: () => () => {},
    emit: (topic, payload) => {
      if (topic === 'llm:status') statuses.push((payload as { live: boolean }).live)
    },
  }
  return { bus, statuses }
}

function assertConverseShape(res: ConverseResult, a: Persona, b: Persona): void {
  expect(res.turns.length).toBeGreaterThanOrEqual(2)
  expect(res.turns[0].speakerId).toBe(a.id)
  for (let i = 0; i < res.turns.length; i++) {
    expect(res.turns[i].speakerId).toBe(i % 2 === 0 ? a.id : b.id)
    expect(res.turns[i].text.trim()).not.toBe('')
  }
  expect(res.aSummary.trim()).not.toBe('')
  expect(res.bSummary.trim()).not.toBe('')
  expect(res.affectionDelta).toBeGreaterThanOrEqual(AFFECTION_CLAMP[0])
  expect(res.affectionDelta).toBeLessThanOrEqual(AFFECTION_CLAMP[1])
}

describe('createBrain with a null / null-returning transport', () => {
  it('dailyPlan matches localPlan exactly (same seeded rng) and never goes live', async () => {
    const { bus, statuses } = recordingBus()
    const brain = createBrain(null, createRng(42), bus)
    const plan = await brain.dailyPlan(seraphine, 1, '', [], PLACES, false)
    expect(plan).toEqual(localPlan(seraphine, createRng(42), false, 1))
    expect(brain.live()).toBe(false)
    expect(statuses).toEqual([])
  })

  it('null-returning transport: converse falls back to localConverse, live() stays false', async () => {
    const { bus, statuses } = recordingBus()
    const brain = createBrain(stub(null), createRng(7), bus)
    const res = await brain.converse(seraphine, thorin, [], [], 60, null, T)
    expect(res).toEqual(localConverse(seraphine, thorin, 60, null, createRng(7), T))
    assertConverseShape(res, seraphine, thorin)
    expect(brain.live()).toBe(false)
    expect(statuses).toEqual([]) // false -> false is not a transition
  })

  it('null-returning transport: chatReply falls back to localChatReply', async () => {
    const brain = createBrain(stub(null), createRng(9))
    const ctx = [mem(1, 'Bram Oakhollow makes the finest honey mead')]
    const reply = await brain.chatReply(seraphine, '👑 holding court — Castle Brightspire', ctx, [], '', 'Tell me about the mead', T)
    expect(reply).toBe(
      localChatReply(seraphine, '👑 holding court — Castle Brightspire', ctx, 'Tell me about the mead', createRng(9)),
    )
    expect(reply.trim()).not.toBe('')
  })

  it('null-returning transport: reflect falls back to localReflect', async () => {
    const memories = [mem(1, 'Thorin Emberhand repaired the castle gates last winter')]
    const brain = createBrain(stub(null), createRng(13))
    const insights = await brain.reflect(seraphine, memories)
    expect(insights).toEqual(localReflect(seraphine, memories, createRng(13)))
    expect(insights.length).toBeGreaterThanOrEqual(2)
  })
})

describe('createBrain with a malformed-JSON transport', () => {
  it('dailyPlan falls back to localPlan but live() goes true (transport answered)', async () => {
    const { bus, statuses } = recordingBus()
    const brain = createBrain(stub('I shall plan the day thusly: {steps: broken['), createRng(42), bus)
    const plan = await brain.dailyPlan(thorin, 2, '', [], PLACES, false)
    expect(plan).toEqual(localPlan(thorin, createRng(42), false, 2))
    expect(brain.live()).toBe(true)
    expect(statuses).toEqual([true])
  })

  it('converse with junk JSON falls back to localConverse', async () => {
    const brain = createBrain(stub('```json\n{"turns": "not an array"}\n```'), createRng(5))
    const res = await brain.converse(seraphine, thorin, [], [], 50, null, T)
    expect(res).toEqual(localConverse(seraphine, thorin, 50, null, createRng(5), T))
  })

  it('reflect with junk falls back to localReflect', async () => {
    const memories = [mem(1, 'The festival rumor weighs on me')]
    const brain = createBrain(stub('no json here at all'), createRng(3))
    expect(await brain.reflect(seraphine, memories)).toEqual(
      localReflect(seraphine, memories, createRng(3)),
    )
  })
})

describe('createBrain with a valid-JSON plan transport', () => {
  it('uses the validated steps: HH:MM coerced, invalid places filtered, sorted, emoji backfilled', async () => {
    const payload = {
      steps: [
        { start: '12:00', durationMin: 60, placeId: 'tavern', activity: 'sharing a hot meal', emoji: '🍲' },
        { start: '07:00', durationMin: 240, placeId: 'forge', activity: 'forging horseshoes' },
        { start: '18:00', durationMin: 120, placeId: 'mordor', activity: 'walking into shadow', emoji: '🌋' },
        { start: '21:30', durationMin: 510, placeId: 'house_thorin', activity: 'sleeping', emoji: '😴' },
      ],
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const plan = await brain.dailyPlan(thorin, 1, '', [], PLACES, false)
    expect(plan).toEqual([
      { startMin: 420, durationMin: 240, placeId: 'forge', activity: 'forging horseshoes', emoji: '🔨' },
      { startMin: 720, durationMin: 60, placeId: 'tavern', activity: 'sharing a hot meal', emoji: '🍲' },
      { startMin: 1290, durationMin: 510, placeId: 'house_thorin', activity: 'sleeping', emoji: '😴' },
    ])
    expect(brain.live()).toBe(true)
  })

  it('injects the festival step when the LLM forgot it on festival day', async () => {
    const payload = {
      steps: [
        { start: '07:00', durationMin: 240, placeId: 'forge', activity: 'forging horseshoes', emoji: '🔨' },
        { start: '18:00', durationMin: 180, placeId: 'tavern', activity: 'swapping tales', emoji: '🍺' },
        { start: '21:30', durationMin: 510, placeId: 'house_thorin', activity: 'sleeping', emoji: '😴' },
      ],
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const plan = await brain.dailyPlan(thorin, 3, '', [], PLACES, true)
    const festival = plan.find((s) => /festival/i.test(s.activity))
    expect(festival).toBeDefined()
    expect(festival!.placeId).toBe('market')
    expect(festival!.startMin).toBe(FESTIVAL_START_MIN)
    expect(festival!.startMin + festival!.durationMin).toBe(FESTIVAL_END_MIN)
    // sleep pushed after the festival, tavern step trimmed to the window edge
    const sleep = plan.find((s) => /sleep/i.test(s.activity))!
    expect(sleep.startMin).toBeGreaterThanOrEqual(FESTIVAL_END_MIN)
    for (const s of plan) {
      if (s === festival) continue
      const overlaps = s.startMin < FESTIVAL_END_MIN && s.startMin + s.durationMin > FESTIVAL_START_MIN
      expect(overlaps).toBe(false)
    }
  })

  it('keeps the festival step the LLM already provided (no duplicate injection)', async () => {
    const payload = {
      steps: [
        { start: '08:00', durationMin: 240, placeId: 'forge', activity: 'forging', emoji: '🔨' },
        { start: '19:00', durationMin: 180, placeId: 'market', activity: 'celebrating the Harvest Moon Festival', emoji: '🎉' },
        { start: '22:00', durationMin: 480, placeId: 'house_thorin', activity: 'sleeping', emoji: '😴' },
      ],
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const plan = await brain.dailyPlan(thorin, 3, '', [], PLACES, true)
    expect(plan.filter((s) => /festival/i.test(s.activity)).length).toBe(1)
  })
})

describe('createBrain converse validation', () => {
  it('maps full-name / first-name speakers to ids and clamps an oversized delta', async () => {
    const payload = {
      turns: [
        { speaker: 'Castellan Seraphine', text: 'Thorin! The gates have never swung truer.' },
        { speaker: 'Thorin Emberhand', text: 'Hm. Iron does what iron must.' },
        { speaker: 'Seraphine', text: 'There will be a festival on Day 3 — come.' },
        { speaker: 'Thorin', text: 'Aye. For the mead, mind, not the dancing.' },
      ],
      aSummary: 'I invited Thorin to the festival.',
      bSummary: 'Seraphine invited me to a festival on Day 3.',
      affectionDelta: 42,
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const res = await brain.converse(seraphine, thorin, [], [], 60, null, T)
    expect(res.turns.map((t) => t.speakerId)).toEqual(['seraphine', 'thorin', 'seraphine', 'thorin'])
    expect(res.affectionDelta).toBe(AFFECTION_CLAMP[1]) // 42 clamped to +5
    expect(res.aSummary).toBe('I invited Thorin to the festival.')
    expect(res.bSummary).toBe('Seraphine invited me to a festival on Day 3.')
  })

  it('clamps a large negative delta to the lower bound', async () => {
    const payload = {
      turns: [
        { speaker: 'Seraphine', text: 'You forgot the gates again.' },
        { speaker: 'Thorin', text: 'I forget nothing.' },
      ],
      aSummary: 'We quarreled.',
      bSummary: 'We quarreled.',
      affectionDelta: -50,
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const res = await brain.converse(seraphine, thorin, [], [], 60, null, T)
    expect(res.affectionDelta).toBe(AFFECTION_CLAMP[0]) // -50 clamped to -3
  })

  it('drops a wrong-first-speaker prefix and merges non-alternating repeats', async () => {
    const payload = {
      turns: [
        { speaker: 'Thorin', text: 'Spoke out of turn.' },
        { speaker: 'Seraphine', text: 'Good morrow, Thorin.' },
        { speaker: 'Seraphine', text: 'I said, good morrow!' },
        { speaker: 'Thorin', text: 'Aye, morrow.' },
      ],
      aSummary: 'A short greeting.',
      bSummary: 'A short greeting.',
      affectionDelta: 1,
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(1))
    const res = await brain.converse(seraphine, thorin, [], [], 60, null, T)
    expect(res.turns).toEqual([
      { speakerId: 'seraphine', text: 'Good morrow, Thorin.' },
      { speakerId: 'thorin', text: 'Aye, morrow.' },
    ])
  })

  it('falls back to localConverse when every speaker name is unknown', async () => {
    const payload = {
      turns: [
        { speaker: 'Gandalf', text: 'You shall not pass.' },
        { speaker: 'Frodo', text: 'I will take the ring.' },
      ],
      aSummary: 'nonsense',
      bSummary: 'nonsense',
      affectionDelta: 2,
    }
    const brain = createBrain(stub(JSON.stringify(payload)), createRng(77))
    const res = await brain.converse(seraphine, thorin, [], [], 60, null, T)
    expect(res).toEqual(localConverse(seraphine, thorin, 60, null, createRng(77), T))
    assertConverseShape(res, seraphine, thorin)
  })

  it('uses valid reflect insights from JSON', async () => {
    const brain = createBrain(stub('{"insights":["I see now that the vale needs a feast.","Thorin matters to me."]}'), createRng(1))
    const insights = await brain.reflect(seraphine, [])
    expect(insights).toEqual([
      'I see now that the vale needs a feast.',
      'Thorin matters to me.',
    ])
  })
})

describe('live() transitions', () => {
  it('emits llm:status on the bus exactly when the state changes', async () => {
    const { bus, statuses } = recordingBus()
    let reply: string | null = 'A plain text answer from the model.'
    const transport: LlmTransport = { complete: async () => reply }
    const brain = createBrain(transport, createRng(1), bus)

    expect(brain.live()).toBe(false)
    await brain.chatReply(seraphine, '👑 holding court', [], [], '', 'Hello', T) // success → live
    expect(brain.live()).toBe(true)
    await brain.chatReply(seraphine, '👑 holding court', [], [], '', 'Again', T) // success → no change
    expect(brain.live()).toBe(true)

    reply = null
    await brain.chatReply(seraphine, '👑 holding court', [], [], '', 'Now fail', T) // fail → not live
    expect(brain.live()).toBe(false)
    await brain.chatReply(seraphine, '👑 holding court', [], [], '', 'Fail again', T) // no change
    expect(brain.live()).toBe(false)

    reply = 'Back among the dreaming.'
    await brain.summarizeChat(seraphine, [], '') // success → live again
    expect(brain.live()).toBe(true)

    expect(statuses).toEqual([true, false, true])
  })

  it('a throwing transport is treated as a failure, never escapes', async () => {
    const transport: LlmTransport = {
      complete: async () => {
        throw new Error('boom')
      },
    }
    const { bus, statuses } = recordingBus()
    const brain = createBrain(transport, createRng(21), bus)
    const plan = await brain.dailyPlan(seraphine, 1, '', [], PLACES, false)
    expect(plan).toEqual(localPlan(seraphine, createRng(21), false, 1))
    expect(brain.live()).toBe(false)
    expect(statuses).toEqual([])
  })
})
