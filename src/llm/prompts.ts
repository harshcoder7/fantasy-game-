/**
 * Everdawn Vale — prompt builders for the LLM brain (llm/brain.ts).
 *
 * Every builder returns { system, user }. Style follows philoagents character
 * cards: roleplay framing, persona traits/backstory/goals/speech style, hard
 * rules pinning the model inside the medieval-fantasy world, and STRICT-JSON
 * demands wherever brain.ts must parse the output.
 */
import type { ChatTurn, GameTime, MemoryRecord, Persona, PlaceDef } from '../types'
import {
  CHAT_REPLY_WORDS,
  FESTIVAL_DAY,
  FRIEND_THRESHOLD,
  MAX_TURNS,
  MIN_TURNS,
} from '../constants'

export interface PromptPair { system: string; user: string }

/** Most chat history lines ever rendered into a prompt. */
const MAX_HISTORY_LINES = 10

// ------------------------------------------------------------------- helpers

const TITLES: ReadonlySet<string> = new Set([
  'castellan', 'brother', 'sister', 'lady', 'lord', 'keeper', 'master', 'mistress',
])

/** "Castellan Seraphine" → "Seraphine", "Thorin Emberhand" → "Thorin". */
export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  for (const part of parts) {
    if (!TITLES.has(part.toLowerCase())) return part
  }
  return parts[0] ?? fullName
}

/** Coarse word for the hour — shared with localBrain greetings. */
export function timeOfDay(time: GameTime): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (time.hour >= 5 && time.hour < 12) return 'morning'
  if (time.hour >= 12 && time.hour < 18) return 'afternoon'
  if (time.hour >= 18 && time.hour < 22) return 'evening'
  return 'night'
}

function clockStr(time: GameTime): string {
  const hh = String(time.hour).padStart(2, '0')
  const mm = String(time.minute).padStart(2, '0')
  return `${hh}:${mm}`
}

function bullets(memories: MemoryRecord[]): string {
  if (memories.length === 0) return '- (nothing of note comes to mind)'
  return memories.map((m) => `- ${m.text}`).join('\n')
}

/** Drop the leading status emoji: "🔥 forging — at the Smithy" → "forging — at the Smithy". */
function cleanStatus(status: string): string {
  const trimmed = status.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  return trimmed !== '' ? trimmed : 'going about your day'
}

function warmthWord(affection: number): string {
  if (affection < 20) return 'wary of one another'
  if (affection < 40) return 'mere acquaintances'
  if (affection < FRIEND_THRESHOLD) return 'on friendly terms'
  if (affection < 80) return 'good friends'
  return 'the dearest of friends'
}

function miniCard(p: Persona): string {
  return (
    `${p.name} — ${p.role}, ${p.age} years old. ` +
    `Character: ${p.traits.join(', ')}. Speaks: ${p.speechStyle}. ` +
    `Goals: ${p.goals.join('; ')}.`
  )
}

// ------------------------------------------------------------ character card

/**
 * Philoagents-style roleplay card. The card itself lives in `system`
 * (user is empty); chatPrompt() builds on top of it.
 */
export function characterCard(p: Persona, status: string, time: GameTime): PromptPair {
  const system = [
    `Let us roleplay. You are ${p.name}, ${p.role} in the fantasy village of Everdawn Vale. You are ${p.age} years old.`,
    `Your character: ${p.traits.join(', ')}.`,
    `Your story: ${p.backstory}`,
    `Your goals: ${p.goals.join('; ')}.`,
    `How you speak: ${p.speechStyle}.`,
    `It is ${timeOfDay(time)} on Day ${time.day} (${clockStr(time)}), and right now you are ${cleanStatus(status)}.`,
    '',
    'Hard rules you must never break:',
    '- Never mention being an AI, a model, an assistant, or anything outside the story.',
    '- Stay inside the medieval-fantasy world of Everdawn Vale — no modern concepts, no machines, no places beyond the vale and its roads.',
    '- Answer in plain text only: no markdown, no lists, no stage directions, no quotation marks around your reply.',
    `- Keep every reply at or under ${CHAT_REPLY_WORDS} words, always in ${firstName(p.name)}'s voice.`,
  ].join('\n')
  return { system, user: '' }
}

// -------------------------------------------------------------- daily plan

export function planPrompt(
  p: Persona,
  day: number,
  yesterday: string,
  contextMemories: MemoryRecord[],
  places: PlaceDef[],
  knowsFestival: boolean,
): PromptPair {
  const system = [
    `You plan the day of ${p.name}, ${p.role} in the fantasy village of Everdawn Vale.`,
    `Their character: ${p.traits.join(', ')}. Their goals: ${p.goals.join('; ')}.`,
    `Their story: ${p.backstory}`,
    'You respond with STRICT JSON only — no commentary, no markdown, no code fences.',
  ].join('\n')

  const placeLines = places
    .map((pl) => `- ${pl.id} (${pl.name}): ${pl.activities.join('; ')}`)
    .join('\n')
  const routineLines = p.routine
    .map((r) => `- ${r.start}, ${r.durationMin} min, at ${r.placeId}: ${r.activity}`)
    .join('\n')

  let festivalNote: string | null = null
  if (knowsFestival && day === FESTIVAL_DAY) {
    festivalNote =
      'IMPORTANT: You WILL attend the Harvest Moon Festival from 19:00 to 22:00 at the market — include exactly that step: ' +
      '{"start":"19:00","durationMin":180,"placeId":"market","activity":"celebrating the Harvest Moon Festival","emoji":"🎉"}.'
  } else if (knowsFestival) {
    festivalNote = `You know the Harvest Moon Festival will be held on the evening of Day ${FESTIVAL_DAY} in the Market Square.`
  }

  const user = [
    `Today is Day ${day} in Everdawn Vale.`,
    `Yesterday: ${yesterday.trim() !== '' ? yesterday.trim() : 'nothing of note — the days before blur together'}.`,
    '',
    'Places in the vale (use "placeId" EXACTLY as written) and what one does there:',
    placeLines,
    '',
    `${firstName(p.name)}'s usual routine, as guidance (adapt it, do not copy it blindly):`,
    routineLines,
    '',
    'Recent thoughts:',
    bullets(contextMemories),
    festivalNote !== null ? `\n${festivalNote}` : null,
    '',
    'Respond with STRICT JSON only, in exactly this shape:',
    '{"steps":[{"start":"HH:MM","durationMin":60,"placeId":"market","activity":"browsing the stalls","emoji":"🛒"}]}',
    `Rules: 6 to 12 steps covering the whole day from waking to sleep; "start" is 24h "HH:MM"; steps are chronological and never overlap; ` +
      `"placeId" must be one of the listed ids; the FINAL step is sleeping at home (placeId "${p.homeId}", activity "sleeping", emoji "😴").`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')

  return { system, user }
}

// -------------------------------------------------------------- reflection

export function reflectPrompt(p: Persona, memories: MemoryRecord[]): PromptPair {
  const system = [
    `You are ${p.name}, ${p.role} in the fantasy village of Everdawn Vale — ${p.traits.join(', ')}.`,
    'You are quietly reflecting on your recent days, drawing deeper insight from what you have seen, heard, and felt.',
    'You respond with STRICT JSON only — no commentary, no markdown, no code fences.',
  ].join('\n')

  const numbered = memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n')
  const user = [
    'Statements about your recent days:',
    numbered,
    '',
    'What 2-3 high-level insights can you draw — about yourself, the people of the vale, or what lies ahead?',
    'Respond with STRICT JSON only:',
    '{"insights":["…","…"]}',
    `Rules: 2 to 3 insights; each a single first-person sentence (as ${firstName(p.name)}) under 160 characters; no numbering inside the strings; stay inside the fantasy world.`,
  ].join('\n')

  return { system, user }
}

// ------------------------------------------------------------ conversation

export function conversePrompt(
  a: Persona,
  b: Persona,
  ctxA: MemoryRecord[],
  ctxB: MemoryRecord[],
  affectionAtoB: number,
  rumorText: string | null,
  time: GameTime,
): PromptPair {
  const aF = firstName(a.name)
  const bF = firstName(b.name)

  const system = [
    'You write a short, natural conversation between two villagers of Everdawn Vale, a medieval-fantasy village.',
    'Stay strictly inside the fantasy world: no modern concepts, and never mention AI or anything outside the story.',
    'You respond with STRICT JSON only — no commentary, no markdown, no code fences.',
  ].join('\n')

  const user = [
    miniCard(a),
    miniCard(b),
    '',
    `What ${aF} knows and feels about ${bF}:`,
    bullets(ctxA),
    `What ${bF} knows and feels about ${aF}:`,
    bullets(ctxB),
    '',
    `They are ${warmthWord(affectionAtoB)}. It is ${timeOfDay(time)} on Day ${time.day} (${clockStr(time)}).`,
    rumorText !== null
      ? `${aF} should naturally share this news during the talk: ${rumorText}.`
      : null,
    '',
    'Respond with STRICT JSON only, in exactly this shape:',
    `{"turns":[{"speaker":"${aF}","text":"…"},{"speaker":"${bF}","text":"…"}],"aSummary":"…","bSummary":"…","affectionDelta":0}`,
    `Rules: ${MIN_TURNS} to ${MAX_TURNS} alternating turns starting with ${aF}; "speaker" is exactly "${aF}" or "${bF}"; ` +
      `each turn is at most 30 words, in that character's own voice; ` +
      `"aSummary" is one first-person line (as ${aF}, at most 25 words) of what ${aF} will remember of this talk; ` +
      `"bSummary" likewise for ${bF}; ` +
      '"affectionDelta" is an integer from -3 to 5 for how the talk changed their warmth toward each other.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n')

  return { system, user }
}

// -------------------------------------------------------------- player chat

export function chatPrompt(
  p: Persona,
  status: string,
  contextMemories: MemoryRecord[],
  history: ChatTurn[],
  summary: string,
  playerMsg: string,
  time: GameTime,
): PromptPair {
  const f = firstName(p.name)
  const systemParts: string[] = [
    characterCard(p, status, time).system,
    '',
    'You are speaking with a mysterious hooded wanderer passing through the vale. You do not know their name — "wanderer" or "stranger" will do.',
    '',
    'Things you remember that may bear on this conversation:',
    bullets(contextMemories),
  ]
  if (summary.trim() !== '') {
    systemParts.push('', `What has passed between you and the wanderer so far: ${summary.trim()}`)
  }
  const system = systemParts.join('\n')

  const lines = history
    .slice(-MAX_HISTORY_LINES)
    .map((t) => `${t.from === 'wanderer' ? 'Wanderer' : f}: ${t.text}`)
  lines.push(`Wanderer: ${playerMsg}`)
  lines.push('', `Now reply as ${f} — plain text only, no name prefix, at most ${CHAT_REPLY_WORDS} words.`)

  return { system, user: lines.join('\n') }
}

// ------------------------------------------------------------ chat summary

export function summarizeChatPrompt(
  p: Persona,
  history: ChatTurn[],
  prevSummary: string,
): PromptPair {
  const f = firstName(p.name)
  const system = [
    `You keep the private memory of ${p.name}, ${p.role} in the fantasy village of Everdawn Vale.`,
    `Condense conversations into one short first-person note as ${f}. Plain text only — no JSON, no quotes, no markdown, at most 60 words. Stay inside the fantasy world.`,
  ].join('\n')

  const lines = history.map((t) => `${t.from === 'wanderer' ? 'The wanderer' : f}: ${t.text}`)
  const user = [
    prevSummary.trim() !== '' ? `Earlier summary: ${prevSummary.trim()}` : null,
    'Conversation since then with the mysterious wanderer:',
    ...lines,
    '',
    `Write the updated one-paragraph summary (first person, as ${f}, at most 60 words), keeping anything still important from the earlier summary.`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')

  return { system, user }
}
