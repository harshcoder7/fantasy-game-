/**
 * Everdawn Vale — rumor board with provenance.
 *
 * Rumors hop villager-to-villager during conversations. The board tracks who
 * knows what; learn() emits 'rumor:spread' (with the new known-count) so the
 * chronicle can visualize information diffusion — the festival rumor is the
 * seeded emergent event.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { EventBus, Rumor, RumorBoardApi, RumorSeed } from '../types'
import { PERSONAS } from '../data/agents'

/**
 * Resolve an agent's given name for the "don't gossip about the listener to
 * their face" rule. Persona ids are lowercase given names ("seraphine"), and
 * names may lead with a title ("Castellan Seraphine"), so prefer the name
 * word that matches the id; fall back to the first name word, then the id.
 */
function firstNameOf(agentId: string): string {
  const persona = PERSONAS.find((p) => p.id === agentId)
  if (persona) {
    const words = persona.name.split(/\s+/).filter((w) => w !== '')
    const idLower = agentId.toLowerCase()
    const given = words.find((w) => w.toLowerCase() === idLower)
    if (given !== undefined) return given
    if (words.length > 0) return words[0]
  }
  return agentId
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive whole-word mention check. */
function mentionsName(text: string, name: string): boolean {
  if (name === '') return false
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)
}

export function createRumorBoard(bus: EventBus): RumorBoardApi {
  const rumors = new Map<string, Rumor>()

  return {
    seed(r: RumorSeed): Rumor {
      const rumor: Rumor = {
        id: r.id,
        text: r.text,
        spice: r.spice,
        sourceId: r.sourceId,
        knownBy: new Set(r.knownBy),
        eventDay: r.eventDay,
        eventStartMin: r.eventStartMin,
        eventPlaceId: r.eventPlaceId,
      }
      rumors.set(rumor.id, rumor)
      return rumor
    },

    get(id: string): Rumor | undefined {
      return rumors.get(id)
    },

    all(): Rumor[] {
      return Array.from(rumors.values())
    },

    knows(agentId: string, rumorId: string): boolean {
      const rumor = rumors.get(rumorId)
      return rumor !== undefined && rumor.knownBy.has(agentId)
    },

    learn(agentId: string, rumorId: string, fromId?: string): boolean {
      const rumor = rumors.get(rumorId)
      if (rumor === undefined || rumor.knownBy.has(agentId)) return false
      rumor.knownBy.add(agentId)
      if (fromId !== undefined) {
        bus.emit('rumor:spread', {
          rumorId: rumor.id,
          fromId,
          toId: agentId,
          knownCount: rumor.knownBy.size,
        })
      }
      return true
    },

    knownByAgent(agentId: string): Rumor[] {
      return Array.from(rumors.values()).filter((r) => r.knownBy.has(agentId))
    },

    pickToSpread(speakerId: string, listenerId: string): Rumor | null {
      const listenerName = firstNameOf(listenerId)
      let best: Rumor | null = null
      for (const rumor of rumors.values()) {
        if (!rumor.knownBy.has(speakerId)) continue
        if (rumor.knownBy.has(listenerId)) continue
        if (mentionsName(rumor.text, listenerName)) continue
        if (
          best === null ||
          rumor.spice > best.spice ||
          (rumor.spice === best.spice && rumor.id < best.id)
        ) {
          best = rumor
        }
      }
      return best
    },
  }
}
