import type { LoreDoc } from '../types'

/**
 * Everdawn Vale — the lore codex. Offline-ingested once at world creation
 * (world.ts) into the shared long-term memory (engine/longTermMemory.ts),
 * then retrieved live to ground villager chat replies (ui/codex.ts) in
 * something more than whatever the model improvises.
 */
export const LORE_DOCS: LoreDoc[] = [
  {
    id: 'founding',
    text:
      'Everdawn Vale was founded three centuries ago by settlers fleeing a war in the lowlands. ' +
      'They chose the valley for its ring of hills, which broke the worst storms before they ' +
      'reached the market square, and for the lake at its northern edge, which never froze even ' +
      'in the hardest winters. The first building raised was not the castle but the well at the ' +
      'heart of the market, dug by hand in a single season so the settlers would never again fear ' +
      'thirst. Castle Brightspire went up a generation later, when the vale had grown prosperous ' +
      'enough to need walls and a Castellan to keep its peace.',
  },
  {
    id: 'harvest-moon-festival',
    text:
      'The Harvest Moon Festival is Everdawn Vale\'s oldest tradition, held every third day of the ' +
      'harvest season when the moon rises full and orange over the Market Square. Lanterns and ' +
      'bunting are strung the afternoon before, a bonfire is lit at dusk, and every villager who ' +
      'hears of it is expected to come, eat, and dance until the embers die down near midnight. ' +
      'The festival marks the end of the hardest labor of the year and the start of the easier, ' +
      'colder months, and it is said that news of the festival always travels by word of mouth ' +
      'alone, villager to villager, never by proclamation — the spreading of the invitation is as ' +
      'much a part of the tradition as the feast itself.',
  },
  {
    id: 'brightspire-castellans',
    text:
      'Castle Brightspire has been held by a line of Castellans, not hereditary rulers but chosen ' +
      'stewards sworn to keep the vale\'s peace and its ledgers honest. The current Castellan, ' +
      'Seraphine, took the seat after her predecessor retired to the temple, and she is known for ' +
      'walking the battlements at dawn to watch the roads before anyone else in the vale is awake.',
  },
  {
    id: 'arcanum-tower',
    text:
      'Arcanum Tower stands apart from the rest of the vale, built on the western hills where the ' +
      'old ley-lines are said to cross. It has housed a single scholar-mage for as long as anyone ' +
      'can remember, cataloguing scrolls and scrying the crystal that sits at the top of its spiral ' +
      'stair. The current keeper, Elara Moonwhisper, is known to trade minor charms and honest ' +
      'omens for favors, though she never reveals more of the future than a person can bear to hear.',
  },
  {
    id: 'lake-lumen',
    text:
      'Lake Lumen, north of the vale past Thistledown Hut, is named for the way its surface seems ' +
      'to hold light long after sunset — villagers say the lakebed is lined with pale stone that ' +
      'drank centuries of moonlight and never let it go. Fishing off its bank is good in every ' +
      'season, and children are told that skipping seven stones across it before dusk brings a ' +
      'lucky year, though nobody in living memory has ever thrown eight.',
  },
  {
    id: 'old-well',
    text:
      'The Old Well in the market square is the oldest structure in Everdawn Vale, older than the ' +
      'castle, dug by the first settlers before anything else was built. Its water has never run ' +
      'dry, not even in the driest summers, and lingering there to draw water has always doubled ' +
      'as the vale\'s favorite excuse for gossip — more rumors have started at the well than ' +
      'anywhere else in the vale.',
  },
  {
    id: 'emberhand-smithy',
    text:
      'Emberhand Smithy has forged the vale\'s horseshoes, blades, and ploughshares for three ' +
      'generations of the same family. The current smith, Thorin Emberhand, learned the trade from ' +
      'his father and grandfather before him, and the smithy\'s furnace is said to have never gone ' +
      'fully cold in all that time, banked overnight and stoked again each dawn.',
  },
  {
    id: 'temple-of-dawn',
    text:
      'The Temple of the Dawn sits on the eastern edge of the vale, where its windows catch the ' +
      'first light each morning. Its priests keep no strict doctrine beyond quiet counsel and the ' +
      'tending of candles for anyone who asks, and the temple bell rings once at sunrise and once ' +
      'at sunset, the only clock most villagers ever need.',
  },
  {
    id: 'whisperwood-grove',
    text:
      'Whisperwood Grove, east of the temple, is named for the sound the wind makes through its ' +
      'birches — villagers swear that on still nights it forms almost-words, though no two people ' +
      'ever agree on what they hear. Herbalists favor it for rare mushrooms, and it is generally ' +
      'considered good luck, not bad, to hear the whispering — only silence in the grove is ' +
      'thought to be an ill omen.',
  },
  {
    id: 'wolves-in-the-hills',
    text:
      'Wolves occasionally come down from the western hills in the leanest part of winter, drawn ' +
      'by the smell of livestock. Villagers keep watch in shifts during those weeks, and it is ' +
      'considered wise to travel the outer roads in pairs after dark until the thaw, though no ' +
      'wolf has taken a life in the vale for as long as anyone can remember.',
  },
]
