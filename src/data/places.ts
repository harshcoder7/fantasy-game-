import type { PlaceDef } from '../types'

/**
 * Everdawn Vale layout. World coords span [-110, 110] on x/z.
 * Entrances are guaranteed-walkable approach points just outside footprints.
 */
export const PLACES: PlaceDef[] = [
  {
    id: 'market', name: 'Market Square', kind: 'market',
    x: 0, z: 6, w: 34, d: 30, entrance: { x: 0, z: 23 }, solid: false,
    activities: ['browsing the stalls', 'haggling over wares', 'people-watching', 'performing for a crowd'],
  },
  {
    id: 'well', name: 'The Old Well', kind: 'well',
    x: 0, z: 2, w: 3, d: 3, entrance: { x: 4, z: 2 }, solid: true,
    activities: ['drawing water', 'lingering for gossip'],
  },
  {
    id: 'castle', name: 'Castle Brightspire', kind: 'castle',
    x: 0, z: -72, w: 40, d: 32, entrance: { x: 0, z: -53 }, solid: true,
    activities: ['holding court', 'reviewing petitions', 'pacing the battlements', 'studying the ledgers'],
  },
  {
    id: 'tavern', name: 'The Gilded Griffin', kind: 'tavern',
    x: -42, z: 14, w: 18, d: 14, entrance: { x: -42, z: 23 }, solid: true, servesFood: true,
    activities: ['pouring ale', 'sharing a hot meal', 'swapping tales by the hearth', 'wiping down the long table'],
  },
  {
    id: 'forge', name: 'Emberhand Smithy', kind: 'forge',
    x: 36, z: 18, w: 14, d: 12, entrance: { x: 36, z: 26 }, solid: true,
    activities: ['forging horseshoes', 'hammering a blade', 'stoking the furnace', 'quenching hot iron'],
  },
  {
    id: 'tower', name: 'Arcanum Tower', kind: 'tower',
    x: -68, z: -48, w: 14, d: 14, entrance: { x: -68, z: -39 }, solid: true,
    activities: ['studying ancient tomes', 'scrying the crystal', 'cataloguing scrolls', 'mixing reagents'],
  },
  {
    id: 'temple', name: 'Temple of the Dawn', kind: 'temple',
    x: 58, z: -44, w: 20, d: 16, entrance: { x: 58, z: -34 }, solid: true,
    activities: ['morning devotions', 'tending the candles', 'offering quiet counsel', 'sweeping the nave'],
  },
  {
    id: 'farm', name: 'Greenhollow Farm', kind: 'farm',
    x: 62, z: 64, w: 44, d: 34, entrance: { x: 62, z: 45 }, solid: false,
    activities: ['tilling the field', 'sowing seed', 'harvesting wheat', 'feeding the hens'],
  },
  {
    id: 'farmhouse', name: 'Greenhollow Farmhouse', kind: 'farmhouse',
    x: 78, z: 76, w: 12, d: 10, entrance: { x: 78, z: 69 }, solid: true, servesFood: true,
    activities: ['cooking a farm supper', 'mending tools by the fire'],
  },
  {
    id: 'windmill', name: 'The Windmill', kind: 'windmill',
    x: 44, z: 78, w: 8, d: 8, entrance: { x: 44, z: 72 }, solid: true,
    activities: ['milling grain'],
  },
  {
    id: 'hut', name: 'Thistledown Hut', kind: 'hut',
    x: -72, z: 58, w: 11, d: 9, entrance: { x: -72, z: 65 }, solid: true, servesFood: true,
    activities: ['brewing tinctures', 'drying herbs', 'tending the herb garden'],
  },
  {
    id: 'house_thorin', name: "Thorin's House", kind: 'house',
    x: 22, z: 42, w: 10, d: 9, entrance: { x: 22, z: 48 }, solid: true, servesFood: true,
    activities: ['resting by the hearth', 'polishing old armor'],
  },
  {
    id: 'house_pip', name: "Pip's Burrow", kind: 'house',
    x: -22, z: 44, w: 9, d: 8, entrance: { x: -22, z: 50 }, solid: true, servesFood: true,
    activities: ['counting the day\'s coin', 'cooking second breakfast'],
  },
  {
    id: 'lake', name: 'Lake Lumen', kind: 'lake',
    x: -58, z: 88, w: 52, d: 38, entrance: { x: -58, z: 66 }, solid: true,
    activities: ['fishing off the bank', 'skipping stones', 'watching the water'],
  },
  {
    id: 'grove', name: 'Whisperwood Grove', kind: 'grove',
    x: 84, z: -8, w: 18, d: 16, entrance: { x: 84, z: -8 }, solid: false,
    activities: ['gathering mushrooms', 'wandering beneath the boughs', 'listening to the birds'],
  },
]

/** Dirt-path ribbons drawn by terrain.ts, entrance → entrance (via market hub feel). */
export const PATH_LINKS: Array<[string, string]> = [
  ['market', 'castle'],
  ['market', 'tavern'],
  ['market', 'forge'],
  ['market', 'temple'],
  ['market', 'house_thorin'],
  ['market', 'house_pip'],
  ['market', 'farm'],
  ['tavern', 'tower'],
  ['tavern', 'hut'],
  ['hut', 'lake'],
  ['farm', 'windmill'],
  ['temple', 'grove'],
]
