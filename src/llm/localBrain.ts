/**
 * Everdawn Vale — LocalBrain: deterministic, rng-driven fallbacks for every
 * Brain capability. The game must play perfectly with zero network; these
 * routines lean on the persona data, the seeded rng and the engine's lexical
 * retrieval to stay in character without an LLM.
 */
import type {
  ChatTurn,
  ConverseResult,
  DialogueTurn,
  GameTime,
  MemoryRecord,
  Persona,
  PlanStep,
  Rng,
} from '../types'
import { FRIEND_THRESHOLD } from '../constants'
import { routineToPlan } from '../engine/planner'
import { relevanceScore, tokenize } from '../engine/memory'
import { PERSONAS } from '../data/agents'
import { firstName, timeOfDay } from './prompts'

// ------------------------------------------------------------------- helpers

const NAME_BY_ID: ReadonlyMap<string, string> = new Map(
  PERSONAS.map((p) => [p.id, p.name]),
)

/** Lowercased tokens of every villager name — excluded from "topic" counting. */
const NAME_TOKENS: ReadonlySet<string> = new Set(
  PERSONAS.flatMap((p) => tokenize(p.name).concat(p.id)),
)

function truncateChars(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim()
}

function truncateWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= max) return text.trim()
  return `${words.slice(0, max).join(' ')}…`
}

function lcFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text
}

function ensureSentence(text: string): string {
  const t = text.trim()
  if (t === '') return t
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

/** Strip the leading status emoji: "🔥 forging — at the Smithy" → the rest. */
function cleanDoing(status: string): string {
  return status.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

// ---------------------------------------------------------------- daily plan

/** Deterministic plan: the persona routine with seeded jitter (+ festival carve-out). */
export function localPlan(
  p: Persona,
  rng: Rng,
  knowsFestival: boolean,
  day: number,
): PlanStep[] {
  return routineToPlan(p, rng, knowsFestival, day)
}

// ---------------------------------------------------------------- reflection

const PERSON_TEMPLATES: ReadonlyArray<(name: string) => string> = [
  (n) => `I have spent much of my time with ${n} of late; they matter to me more than I say aloud.`,
  (n) => `${n} keeps appearing in my days — the vale would feel emptier without them.`,
  (n) => `I should speak plainly with ${n} soon; our paths cross too often for chance.`,
  (n) => `When I look back over these days, it is ${n} I remember first.`,
  (n) => `I realize ${n} has become part of the shape of my days.`,
]

const TOPIC_TEMPLATES: ReadonlyArray<(topic: string) => string> = [
  (t) => `My thoughts keep circling back to ${t}; it must matter more than I admitted.`,
  (t) => `So much of what I have seen lately concerns ${t} — I would do well to heed it.`,
  (t) => `I realize that ${t} weighs on my mind more with each passing day.`,
  (t) => `If these days have taught me anything, it is to pay attention to ${t}.`,
]

const GOAL_TEMPLATES: ReadonlyArray<(goal: string) => string> = [
  (g) => `I must not lose sight of what I set out to do: ${g}.`,
  (g) => `Day by day I edge closer to my aim — ${g}.`,
  (g) => `Whatever else the vale asks of me, I hold to this: ${g}.`,
  (g) => `My heart keeps returning to one purpose: ${g}.`,
]

/**
 * Template reflection: frequency-count the subjects and keywords of the given
 * memories, then phrase two first-person insights about the most frequent
 * villager and topic (falling back to the persona's goals).
 */
export function localReflect(p: Persona, memories: MemoryRecord[], rng: Rng): string[] {
  const personCounts = new Map<string, number>()
  const topicCounts = new Map<string, number>()

  for (const m of memories) {
    for (const s of m.subjects) {
      if (s === p.id) continue
      const name = NAME_BY_ID.get(s)
      if (name !== undefined) personCounts.set(name, (personCounts.get(name) ?? 0) + 1)
    }
    for (const tok of tokenize(m.text)) {
      if (tok.length < 4 || NAME_TOKENS.has(tok)) continue
      topicCounts.set(tok, (topicCounts.get(tok) ?? 0) + 1)
    }
  }

  function topKey(counts: Map<string, number>): string | null {
    let best: string | null = null
    let bestCount = 0
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key
        bestCount = count
      }
    }
    return best
  }

  const topPerson = topKey(personCounts)
  const topTopic = topKey(topicCounts)

  const insights: string[] = []
  if (topPerson !== null) insights.push(rng.pick(PERSON_TEMPLATES)(topPerson))
  if (topTopic !== null) insights.push(rng.pick(TOPIC_TEMPLATES)(topTopic))
  while (insights.length < 2) {
    const goal = p.goals.length > 0 ? rng.pick(p.goals) : 'tend faithfully to my work in the vale'
    let candidate = rng.pick(GOAL_TEMPLATES)(goal)
    if (insights.includes(candidate)) candidate = `Above all else: ${goal}.`
    insights.push(candidate)
  }
  return insights.slice(0, 2)
}

// -------------------------------------------------------------- conversation

type VoiceStyle = 'bright' | 'gruff' | 'serene' | 'bookish' | 'plain'

const STYLE_KEYWORDS: ReadonlyArray<readonly [VoiceStyle, readonly string[]]> = [
  ['bright', ['jovial', 'charming', 'dramatic', 'theatrical', 'cheerful', 'restless', 'gossipy', 'nosy', 'generous']],
  ['gruff', ['gruff', 'plainspoken', 'perfectionist', 'practical', 'steadfast', 'wry']],
  ['serene', ['serene', 'wise', 'patient', 'attentive', 'dutiful', 'poised', 'kind']],
  ['bookish', ['curious', 'precise', 'reclusive', 'night-owl', 'shrewd', 'cunning']],
]

function voiceOf(p: Persona): VoiceStyle {
  const traits = p.traits.map((t) => t.toLowerCase())
  for (const [style, keys] of STYLE_KEYWORDS) {
    if (traits.some((t) => keys.some((k) => t.includes(k)))) return style
  }
  return 'plain'
}

type Line = (other: string, tod: string) => string

const GREETINGS: Readonly<Record<VoiceStyle, readonly Line[]>> = {
  gruff: [
    (o, tod) => `${o}. Fine ${tod} for honest work.`,
    (o) => `Hm. ${o}. Still standing, then.`,
    (o, tod) => `${o}. The ${tod} won't wait, but a word never hurt.`,
  ],
  bright: [
    (o, tod) => `${o}! The very face this ${tod} was missing!`,
    (o, tod) => `Well met, ${o} — the ${tod} smiles on us both!`,
    (o, tod) => `${o}, my friend! What a fine ${tod} to cross paths!`,
  ],
  serene: [
    (o, tod) => `Peace of the ${tod} to you, ${o}.`,
    (o, tod) => `A blessed ${tod}, ${o}. The vale is kind today.`,
    (o, tod) => `${o}. The ${tod} light suits you well.`,
  ],
  bookish: [
    (o, tod) => `Oh — ${o}. Good ${tod}. Forgive me, I was lost in thought.`,
    (o, tod) => `${o}. A fair ${tod} for observation, is it not?`,
    (o, tod) => `Good ${tod}, ${o}. The vale keeps offering things to study.`,
  ],
  plain: [
    (o, tod) => `Good ${tod}, ${o}.`,
    (o, tod) => `Well met this ${tod}, ${o}.`,
    (o, tod) => `${o}! Good ${tod} to you.`,
  ],
}

const GREETING_REPLIES: Readonly<Record<VoiceStyle, readonly Line[]>> = {
  gruff: [
    (o) => `Aye, ${o}. Work waits, but talk is free.`,
    (_, tod) => `Hm. Fair enough, as ${tod}s go.`,
    (o) => `${o}. Good to see your boots still carry you.`,
  ],
  bright: [
    (o) => `And to you, ${o}! Now tell me everything!`,
    (o) => `Brighter for the sight of you, ${o}!`,
    (o, tod) => `Ha! The ${tod} improves already, ${o}.`,
  ],
  serene: [
    (o) => `And peace to you, ${o}. It does the heart good to stop a moment.`,
    (o, tod) => `Kindly said, ${o}. The ${tod} has been gentle so far.`,
    (o) => `Well met, ${o}. The vale gathers us when we need it.`,
  ],
  bookish: [
    (o) => `Likewise, ${o}. I had not noticed the hour pass.`,
    (o, tod) => `Good ${tod}, ${o}. I was just puzzling over something.`,
    (o) => `Ah, ${o}. Company is good practice, they tell me.`,
  ],
  plain: [
    (o) => `And to you, ${o}.`,
    (o, tod) => `A fine ${tod} indeed, ${o}.`,
    (o) => `Well met, ${o}.`,
  ],
}

const RUMOR_SHARES: ReadonlyArray<(rumor: string) => string> = [
  (r) => `Have you heard the news? ${r}.`,
  (r) => `Between us — ${r}. I had it on good word.`,
  (r) => `Word travels in the vale: ${r}. What do you make of that?`,
]

const RUMOR_REPLIES: readonly string[] = [
  'Truly? The vale will speak of little else, mark me.',
  'Well now — that is news indeed. I thank you for it.',
  "You don't say! I shall keep both ears open.",
]

const VALE_TOPICS: readonly string[] = [
  'the coming harvest',
  'the weather turning over the vale',
  'the price of grain at market',
  "travelers on the king's road",
  'old tales of Castle Brightspire',
  'the mist over Lake Lumen',
]

const TOPIC_OPENERS: ReadonlyArray<(topic: string) => string> = [
  (t) => `Tell me — what do you make of ${t}?`,
  (t) => `My mind keeps turning to ${t} of late.`,
  (t) => `There is much afoot. ${t.charAt(0).toUpperCase()}${t.slice(1)}, for one.`,
]

const GOAL_OPENERS: ReadonlyArray<(goal: string) => string> = [
  (g) => `There is much on my mind — ${g}, for one thing.`,
  (g) => `I have set myself a task: ${g}. It fills my days.`,
]

const TOPIC_REPLIES: ReadonlyArray<(topic: string) => string> = [
  (t) => `Aye — ${t} carries weight, no mistake.`,
  () => 'Mm. Time will tell, as it always does.',
  () => 'The vale provides, one way or another.',
]

const CLOSINGS_A: ReadonlyArray<Line> = [
  (o, tod) => `Well — the ${tod} will not wait. Be well, ${o}.`,
  (o, tod) => `I must be off. Fair ${tod} to you, ${o}.`,
  (o) => `We shall speak again soon, ${o}.`,
]

const CLOSINGS_B: ReadonlyArray<Line> = [
  (o) => `And to you, ${o}. Until our paths cross again.`,
  (o) => `Go well, ${o}.`,
  (o) => `Fare you well, ${o}.`,
]

/**
 * Template conversation: trait-flavored greetings, a topic exchange (the rumor
 * when one is being passed, else a goal or vale topic), and closings. 4-6
 * alternating turns starting with `a`, plus first-person summaries and a small
 * positive affection drift (friends drift a touch warmer).
 */
export function localConverse(
  a: Persona,
  b: Persona,
  affectionAtoB: number,
  rumorText: string | null,
  rng: Rng,
  time: GameTime,
): ConverseResult {
  const tod = timeOfDay(time)
  const aF = firstName(a.name)
  const bF = firstName(b.name)
  const aVoice = voiceOf(a)
  const bVoice = voiceOf(b)

  const turns: DialogueTurn[] = []
  turns.push({ speakerId: a.id, text: rng.pick(GREETINGS[aVoice])(bF, tod) })
  turns.push({ speakerId: b.id, text: rng.pick(GREETING_REPLIES[bVoice])(aF, tod) })

  let topicGist: string
  if (rumorText !== null) {
    turns.push({ speakerId: a.id, text: rng.pick(RUMOR_SHARES)(rumorText) })
    turns.push({ speakerId: b.id, text: rng.pick(RUMOR_REPLIES) })
    topicGist = truncateWords(rumorText, 12)
  } else {
    const useGoal = a.goals.length > 0 && rng.chance(0.4)
    const topic = useGoal ? rng.pick(a.goals) : rng.pick(VALE_TOPICS)
    const opener = useGoal ? rng.pick(GOAL_OPENERS)(topic) : rng.pick(TOPIC_OPENERS)(topic)
    turns.push({ speakerId: a.id, text: opener })
    turns.push({ speakerId: b.id, text: rng.pick(TOPIC_REPLIES)(topic) })
    topicGist = truncateWords(topic, 10)
  }

  const total = rng.int(4, 6)
  if (total >= 5) turns.push({ speakerId: a.id, text: rng.pick(CLOSINGS_A)(bF, tod) })
  if (total >= 6) turns.push({ speakerId: b.id, text: rng.pick(CLOSINGS_B)(aF, tod) })

  const aSummary =
    rumorText !== null
      ? truncateChars(`I told ${b.name} the news: ${lcFirst(rumorText)}.`, 200)
      : `I spoke with ${b.name} this ${tod} about ${topicGist}.`
  const bSummary =
    rumorText !== null
      ? truncateChars(`${a.name} told me the news: ${lcFirst(rumorText)}.`, 200)
      : `I spoke with ${a.name} this ${tod} about ${topicGist}.`

  const affectionDelta = rng.int(0, 2) + (affectionAtoB >= FRIEND_THRESHOLD ? 1 : 0)

  return { turns, aSummary, bSummary, affectionDelta }
}

// -------------------------------------------------------------- player chat

const GREETING_RE =
  /^\s*(hi|hey|hello|hail|greetings|well met|good\s+(morrow|morning|day|afternoon|evening))[\s!,.?]*$/i

const ASKS_DOING_RE = /\b(doing|busy|work|working|now|today|up to|labou?r|task)\b/i

/**
 * In-character reply without an LLM: surface the most relevant memory for the
 * wanderer's words (lexical cosine over the retrieved context), else answer
 * from role and goals, mentioning the current doing when the wanderer asks.
 */
export function localChatReply(
  p: Persona,
  status: string,
  context: MemoryRecord[],
  playerMsg: string,
  rng: Rng,
): string {
  const doing = cleanDoing(status)
  const doingLine = doing !== '' ? ` Just now I am ${doing}.` : ''

  if (GREETING_RE.test(playerMsg)) {
    return rng.pick([
      `Well met, wanderer. I am ${p.name}, ${p.role} of this vale.${doingLine}`,
      `Greetings, stranger. ${p.name}, ${p.role} — at your service, more or less.`,
      `Hail, traveler. We see few new faces in Everdawn Vale; I am ${p.name}.${doingLine}`,
    ])
  }

  let best: MemoryRecord | null = null
  let bestScore = 0.05
  for (const m of context) {
    const s = relevanceScore(playerMsg, m.text)
    if (s > bestScore) {
      bestScore = s
      best = m
    }
  }

  const asksDoing = ASKS_DOING_RE.test(playerMsg)

  if (best !== null) {
    const mem = truncateChars(best.text, 180)
    const reply = rng.pick([
      `Hm — that stirs a memory. ${ensureSentence(mem)} Make of that what you will, wanderer.`,
      `You ask well. ${ensureSentence(mem)} That much I know to be true.`,
      `Since you ask: ${ensureSentence(lcFirst(mem))} So the matter stands in the vale.`,
    ])
    return asksDoing && doingLine !== '' ? reply + doingLine : reply
  }

  const goal = p.goals.length > 0 ? rng.pick(p.goals) : 'my work in the vale'
  const reply = rng.pick([
    `I am ${p.name}, ${p.role} here in Everdawn Vale, and my thoughts dwell mostly on this: ${goal}.`,
    `That is beyond my knowing, wanderer. My world is this vale — and ${lcFirst(goal)} besides.${doingLine}`,
    `Ask the wind, stranger; I keep to my own matters. ${ensureSentence(goal.charAt(0).toUpperCase() + goal.slice(1))} That is what fills my days.`,
  ])
  return asksDoing && doingLine !== '' && !reply.includes(doingLine) ? reply + doingLine : reply
}

// ------------------------------------------------------------- chat summary

/** Short gist concat: previous summary plus what the wanderer asked about. */
export function localSummarizeChat(
  p: Persona,
  history: ChatTurn[],
  prevSummary: string,
): string {
  void p
  const asked = history
    .filter((t) => t.from === 'wanderer')
    .map((t) => truncateWords(t.text, 8))
    .slice(-3)
  const line =
    asked.length > 0
      ? `The mysterious wanderer asked me about: ${asked.join('; ')}.`
      : 'The mysterious wanderer and I traded a few quiet words.'
  const prev = truncateChars(prevSummary, 220)
  const combined = prev !== '' ? `${prev} ${line}` : line
  return truncateChars(combined, 400)
}
