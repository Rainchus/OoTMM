import { World } from './world';
import { Analysis } from './analysis';
import { Random, sample, shuffle } from '../random';
import { DUNGEON_REWARDS_ORDERED, isDungeonReward, isGoldToken, itemsArray, isKey, isHouseToken, isGanonBossKey, isStrayFairy, isToken, isTownStrayFairy, isSong, isSmallKeyRegular, isSmallKeyHideout, isMapCompass, ITEMS_MASKS_REGULAR, isSmallKeyRegularOot, isSmallKeyRegularMm, isRegularBossKeyOot, isRegularBossKeyMm, isItemTriforce, Item, itemData, makeItem } from './items';
import { Settings } from '../settings';
import { Game } from '../config';
import { Monitor } from '../monitor';
import { Pathfinder } from './pathfind';
import { ItemPlacement } from './solve';
import { Location, locationData, makeLocation } from './locations';
import { Region, makeRegion, regionData } from './regions';

const FIXED_HINTS_LOCATIONS = [
  'OOT Skulltula House 10 Tokens',
  'OOT Skulltula House 20 Tokens',
  'OOT Skulltula House 30 Tokens',
  'OOT Skulltula House 40 Tokens',
  'OOT Skulltula House 50 Tokens',
  'OOT Hyrule Field Ocarina of Time',
  'OOT Hyrule Field Song of Time',
  'MM Laboratory Zora Song',
  'MM Moon Fierce Deity Mask',
  'MM Woodfall Great Fairy',
  'MM Snowhead Great Fairy',
  'MM Great Bay Great Fairy',
  'MM Ikana Great Fairy',
  'MM Goron Powder Keg',
  'MM Waterfall Rapids Beaver Race 1',
  'MM Waterfall Rapids Beaver Race 2',
  'MM Swamp Spider House Mask of Truth',
  'MM Ocean Spider House Wallet',
  'MM Clock Town Great Fairy',
  'MM Clock Town Great Fairy Alt',
]

const HINTS_ITEMS_ALWAYS = [
  'OOT_FROGS_FINAL',
  'OOT_FISHING',
  'MM_RANCH_DEFENSE',
  'MM_BUTLER_RACE',
  'MM_COUPLE_MASK',
  'MM_DON_GERO_CHOIR',
  'MM_GORON_RACE',
  'MM_GRAVEYARD_NIGHT3',
];

const HINTS_ITEMS_SOMETIMES = [
  'OOT_RAVAGED_VILLAGE',
  'OOT_ZORA_KING',
  'OOT_GANON_FAIRY',
  'OOT_TEMPLE_FIRE_HAMMER',
  'OOT_TEMPLE_FIRE_SCARECROW',
  'OOT_GTG_WATER',
  'OOT_HAUNTED_WASTELAND',
  'OOT_GERUDO_ARCHERY',
  'MM_BANK_3',
  'MM_SOUND_CHECK',
  'MM_BOAT_ARCHERY',
  'MM_OSH_CHEST',
  'MM_PINNACLE_ROCK_HP',
  'MM_FISHERMAN_GAME',
  'MM_SONG_ELEGY',
  'MM_SECRET_SHRINE_WART_HP',
];

export type HintGossipHero = {
  type: 'hero',
  region: Region,
  location: Location;
};

export type HintGossipFoolish = {
  type: 'foolish',
  region: Region,
};

export type HintGossipItemExact = {
  type: 'item-exact',
  check: string,
  items: Item[],
};

export type HintGossipItemRegion = {
  type: 'item-region',
  region: Region,
  item: Item;
};

export type HintGossip = { game: Game } & (HintGossipHero | HintGossipFoolish | HintGossipItemExact | HintGossipItemRegion);

type WorldItemHints = {
  dungeonRewards: Region[];
  lightArrow: Region;
  oathToOrder: Region;
  ganonBossKey: Region;
};

export type WorldHints = WorldItemHints & {
  foolish: {[k: string]: number};
  gossip: {[k: string]: HintGossip};
};

export type Hints = WorldHints[];

export type HintClass = 'woth' | 'item' | 'location';

export class LogicPassHints {
  private hintedLocations = new Set<Location>();
  private gossip: {[k: string]: HintGossip}[];
  private woth: Set<Location>;
  private pathfinder: Pathfinder;
  private hintsAlways: string[];
  private hintsSometimes: string[];

  constructor(
    private readonly state: {
      monitor: Monitor,
      random: Random,
      settings: Settings,
      world: World,
      items: ItemPlacement,
      analysis: Analysis,
      fixedLocations: Set<string>,
    },
  ){
    this.hintsAlways = this.alwaysHints();
    this.hintsSometimes = this.sometimesHints();
    this.pathfinder = new Pathfinder(state.world, state.settings);
    this.woth = new Set(Array.from(this.state.analysis.required).filter(loc => this.isLocationHintable(loc, 'woth')));
    this.gossip = Array.from({ length: this.state.settings.players }).map(_ => ({}));
  }

  private alwaysHints() {
    const { settings } = this.state;
    const alwaysHints = [...HINTS_ITEMS_ALWAYS];

    if (settings.cowShuffleOot) {
      alwaysHints.push('OOT_COW_LINK');
    }

    return alwaysHints;
  }

  private sometimesHints() {
    const { settings } = this.state;
    const sometimesHints = [...HINTS_ITEMS_SOMETIMES];

    if (settings.cowShuffleMm) {
      sometimesHints.push('MM_COW_WELL');
    }

    return sometimesHints;
  }

  private findItems(item: Item) {
    const locs: Location[] = [];

    for (const sphere of this.state.analysis.spheres) {
      for (const loc of sphere) {
        if (this.state.items.get(loc) === item) {
          locs.push(loc);
        }
      }
    }

    for (const loc of this.state.items.keys()) {
      if (this.state.items.get(loc) === item) {
        locs.push(loc);
      }
    }

    return [...new Set(locs)];
  }

  private findItem(item: Item) {
    const items = this.findItems(item);
    if (items.length === 0) {
      return null;
    }
    return items[0];
  }

  private toRegion(world: number, loc: Location | null) {
    if (loc === null) {
      return makeRegion('NONE', world);
    }
    const locD = locationData(loc);
    return makeRegion(this.state.world.regions[locD.id], locD.world as number);
  }

  private isLocationHintable(loc: Location, klass: HintClass) {
    /* Get the item and region  */
    const item = this.state.items.get(loc)!;
    const locD = locationData(loc);
    const region = this.state.world.regions[locD.id];

    /* These specific locations are always ignored */
    if (['OOT Temple of Time Medallion', 'MM Oath to Order', 'OOT Hatch Chicken', 'OOT Hatch Pocket Cucco'].includes(locD.id)) {
      return false;
    }

    /* Non-shuffled items are ignored */
    if (this.state.fixedLocations.has(locD.id)) {
      return false;
    }

    /* CHecks with no region are ignored (skip zelda) */
    if (!region || region === 'NONE') {
      return false;
    }

    /* Non-shuffled hideout keys */
    if (isSmallKeyHideout(item) && this.state.settings.smallKeyShuffleHideout !== 'anywhere') {
      return false;
    }

    /* Non-shuffled regular keys */
    if (isSmallKeyRegularOot(item) && this.state.settings.smallKeyShuffleOot !== 'anywhere') {
      return false;
    }
    if (isSmallKeyRegularMm(item) && this.state.settings.smallKeyShuffleMm !== 'anywhere') {
      return false;
    }

    /* Non-shuffled Ganon BK (doesn't really matter) */
    if (isGanonBossKey(item) && this.state.settings.ganonBossKey !== 'anywhere') {
      return false;
    }

    /* Non shuffled boss keys */
    if (isRegularBossKeyOot(item) && this.state.settings.bossKeyShuffleOot !== 'anywhere') {
      return false;
    }

    if (isRegularBossKeyMm(item) && this.state.settings.bossKeyShuffleMm !== 'anywhere') {
      return false;
    }

    /* Non shuffled town fairy */
    if (isTownStrayFairy(item) && this.state.settings.townFairyShuffle === 'vanilla') {
      return false;
    }

    /* Non shuffled stray fairy */
    if (isStrayFairy(item) && this.state.settings.strayFairyShuffle !== 'anywhere') {
      return false;
    }

    /* Non-shuffled map/compass (doesn't really matter) */
    if (isMapCompass(item) && this.state.settings.mapCompassShuffle !== 'anywhere') {
      return false;
    }

    /* Non-shuffled dungeon reward */
    if (isDungeonReward(item) && this.state.settings.dungeonRewardShuffle === 'dungeonBlueWarps') {
      return false;
    }

    /* Non shuffled GS token */
    /* TODO: Handle dungeon/overworld better */
    if (isGoldToken(item) && this.state.settings.goldSkulltulaTokens === 'none') {
      return false;
    }

    /* Non shuffled House tokens */
    if (isHouseToken(item) && this.state.settings.housesSkulltulaTokens === 'none') {
      return false;
    }

    /* Triforce Piece - never hinted outside of location */
    if (isItemTriforce(item) && klass !== 'location') {
      return false;
    }

    /* Additional restrictions for WotH */
    if (klass === 'woth') {
      if (isKey(item) || isStrayFairy(item) || isToken(item) || isDungeonReward(item)) {
        return false;
      }
      if (isSong(item) && this.state.settings.songs !== 'anywhere') {
        return false;
      }
    }

    return true;
  }

  private findValidGossip(world: number, locs: Set<Location> | Location) {
    if (typeof locs === 'string') {
      locs = new Set([locs]);
    }
    const pathfinderState = this.pathfinder.run(null, { gossips: true, recursive: true, items: this.state.items, forbiddenLocations: locs });
    const gossips = Array.from(pathfinderState.gossips[world]).filter(x => ['gossip', 'gossip-grotto'].includes(this.state.world.gossip[x].type)).filter(x => !this.gossip[world][x]);
    if (gossips.length === 0) {
      return null;
    }
    return sample(this.state.random, gossips);
  }

  private playthroughLocations(player: number) {
    const locations = this.state.analysis.spheres.flat()
      .filter(loc => itemData(this.state.items.get(loc)!).player === player)
      .filter(loc => this.isLocationHintable(loc, 'item'));
    return shuffle(this.state.random, locations);
  }

  private locationFoolish(loc: Location) {
    if (!this.isLocationHintable(loc, 'location') || this.state.analysis.unreachable.has(loc)) {
      return 0;
    }
    if (!this.state.analysis.useless.has(loc)) {
      return -1;
    }
    if (this.hintedLocations.has(loc) || this.state.settings.junkLocations.includes(locationData(loc).id)) {
      return 0;
    }
    return 1;
  }

  private foolishRegions(world: number) {
    let regions: {[k:string]: number} = {};

    for (const locationId in this.state.world.checks) {
      const location = makeLocation(locationId, world);
      const region = this.state.world.regions[locationId];
      regions[region] ||= 0;
      if (regions[region] === -1) {
        continue;
      }
      const value = this.locationFoolish(location);
      if (value === -1) {
        regions[region] = -1;
      } else {
        regions[region] += value;
      }
    }

    for (const r in regions) {
      if (regions[r] <= 0) {
        delete regions[r];
      }
    }

    return regions;
  }

  private placeGossipItemExact(world: number, checkWorld: number, checkHint: string, extra: number, isMoon: boolean) {
    if (checkHint === 'NONE') {
      return false;
    }
    const locations = (this.state.world.checkHints[checkHint] || []).map(x => makeLocation(x, checkWorld));
    if (locations.every(l => this.hintedLocations.has(l))) {
      return false;
    }
    const items = locations.map(l => this.state.items.get(l)!);
    let gossip;
    if (isMoon) {
      const candidates = Object.keys(this.state.world.gossip)
        .filter(x => this.state.world.gossip[x].type === 'gossip-moon')
        .filter(x => !this.gossip[world][x]);
      if (candidates.length === 0)
        return false;
      gossip = sample(this.state.random, candidates);
    } else {
      gossip = this.findValidGossip(world, new Set(locations));
    }
    if (!gossip) {
      return false;
    }

    /* Found a valid gossip */
    for (const l of locations) {
      this.hintedLocations.add(l);
    }
    const hint: HintGossip = { game: this.state.world.gossip[gossip].game, type: 'item-exact', items, check: checkHint };
    this.placeWithExtra(world, gossip, hint, extra);
    return true;
  }

  private placeGossipItemExactPool(world: number, pool: string[], count: number | 'max', extra: number) {
    if (count === 'max') {
      count = pool.length;
    }
    let placed = 0;
    pool = shuffle(this.state.random, pool);
    for (const checkHint of pool) {
      if (placed >= count) {
        break;
      }
      const locations = (this.state.world.checkHints[checkHint] || []).map(x => makeLocation(x, world));
      if (!locations) {
        continue;
      }
      if (locations.every(l => this.state.settings.junkLocations.includes(locationData(l).id))) {
        continue;
      }
      if (this.placeGossipItemExact(world, world, checkHint, extra, false)) {
        placed++;
      }
    }
    return placed;
  }

  private placeGossipFoolish(world: number, regions: {[k: string]: number}, count: number | 'max', extra: number) {
    if (count === 'max') {
      count = 999;
    }
    let placed = 0;
    regions = { ...regions };
    while (placed < count) {
      const regionsArray = itemsArray(regions); /* Ugly */
      if (regionsArray.length === 0) {
        break;
      }
      const region = sample(this.state.random, regionsArray);
      delete regions[region];
      const gossips = Object.keys(this.state.world.gossip)
        .filter(x => !this.gossip[world][x])
        .filter(x => ['gossip', 'gossip-grotto'].includes(this.state.world.gossip[x].type));
      if (gossips.length === 0)
        break;
      const gossip = sample(this.state.random, gossips);

      /* Found a gossip */
      for (const locId in this.state.world.checks) {
        const loc = makeLocation(locId, world);
        if (this.state.world.regions[locId] === region) {
          this.hintedLocations.add(loc);
        }
      }

      const hint: HintGossip = { game: this.state.world.gossip[gossip].game, type: 'foolish', region: makeRegion(region, world) };
      this.placeWithExtra(world, gossip, hint, extra);

      placed++;
    }
    return placed;
  }

  private placeGossipHero(world: number, count: number | 'max', extra: number) {
    if (count === 'max') {
      count = 999;
    }
    let placed = 0;
    const locs = shuffle(this.state.random, Array.from(this.woth)
      .filter(loc => locationData(loc).world === world)
      .filter(loc => !this.hintedLocations.has(loc)));

    for (;;) {
      if (placed >= count || locs.length === 0) {
        break;
      }
      const loc = locs.pop()!;
      const gossip = this.findValidGossip(world, loc);
      if (gossip !== null) {
        const locD = locationData(loc);
        this.hintedLocations.add(loc);
        const hint: HintGossip = { game: this.state.world.gossip[gossip].game, type: 'hero', region: makeRegion(this.state.world.regions[locD.id], locD.world as number), location: loc };
        this.placeWithExtra(world, gossip, hint, extra);
        placed++;
      }
    }
    return placed;
  }

  private placeGossipItemRegion(world: number, location: Location | null, extra: number, isMoon: boolean) {
    if (location === null) {
      return false;
    }
    const locD = locationData(location);
    if (this.hintedLocations.has(location) && !isMoon) {
      return false;
    }
    const item = this.state.items.get(location)!;
    const hint = this.state.world.checks[locD.id].hint;
    if (this.placeGossipItemExact(world, locD.world as number, hint, extra, isMoon)) {
      return true;
    }
    let gossip;
    if (isMoon) {
      const candidates = Object.keys(this.state.world.gossip)
        .filter(x => this.state.world.gossip[x].type === 'gossip-moon')
        .filter(x => !this.gossip[world][x]);
      if (candidates.length === 0)
        return false;
      gossip = sample(this.state.random, candidates);
    } else {
      gossip = this.findValidGossip(world, location);
    }
    if (gossip === null) {
      return false;
    }
    this.hintedLocations.add(location);
    const h: HintGossip = { game: this.state.world.gossip[gossip].game, type: 'item-region', item, region: makeRegion(this.state.world.regions[locD.id], locD.world as number) };
    this.placeWithExtra(world, gossip, h, extra);
    return true;
  }

  private placeGossipItemName(world: number, itemId: string, count: number | 'max', extra: number) {
    const item = makeItem(itemId, world);
    const locations = this.findItems(item);
    if (count === 'max') {
      count = locations.length;
    }
    let placed = 0;
    for (let i = 0; i < locations.length; ++i) {
      if (placed >= count)
        break;
      const loc = locations[i];
      if (this.placeGossipItemRegion(world, loc, extra, false)) {
        placed++;
      }
    }
    return placed;
  }

  private placeGossipItemRegionSpheres(world: number, count: number | 'max', extra: number) {
    if (count === 'max') {
      count = 999;
    }
    const locations = this.playthroughLocations(world);
    let placed = 0;
    for (const loc of locations) {
      if (placed >= count) {
        break;
      }
      if (this.placeGossipItemRegion(world, loc, extra, false)) {
        placed++;
      }
    }
    return placed;
  }

  private place(world: number, loc: string, hint: HintGossip) {
    /* KLUDGE */
    if (loc.startsWith('MM ')) {
      hint.game = 'mm';
    } else {
      hint.game = 'oot';
    }
    this.gossip[world][loc] = { ...hint };
  }

  private placeWithExtra(world: number, loc: string, hint: HintGossip, extra: number) {
    this.place(world, loc, hint);

    for (let i = 0; i < extra; ++i) {
      const gossips = Object.keys(this.state.world.gossip)
        .filter(x => !this.gossip[world][x])
        .filter(x => ['gossip', 'gossip-grotto'].includes(this.state.world.gossip[x].type));
      if (gossips.length === 0) {
        break;
      }
      const gossip = sample(this.state.random, gossips);
      this.place(world, gossip, hint);
    }
  }

  private placeMoonGossip(world: number) {
    for (const mask of ITEMS_MASKS_REGULAR) {
      const location = this.findItem(makeItem(mask, world));
      this.placeGossipItemRegion(world, location, 0, true);
    }
  }

  private placeGossips(world: number, foolish: {[k: string]: number}) {
    const settingsHints = this.state.settings.hints;

    for (const s of settingsHints) {
      switch (s.type) {
      case 'always':
        this.placeGossipItemExactPool(world, this.hintsAlways, s.amount, s.extra);
        break;
      case 'sometimes':
        this.placeGossipItemExactPool(world, this.hintsSometimes, s.amount, s.extra);
        break;
      case 'foolish':
        this.placeGossipFoolish(world, foolish, s.amount, s.extra);
        break;
      case 'item':
        this.placeGossipItemName(world, s.item!, s.amount, s.extra);
        break;
      case 'playthrough':
        this.placeGossipItemRegionSpheres(world, s.amount, s.extra);
        break;
      case 'woth':
        this.placeGossipHero(world, s.amount, s.extra);
        break;
      }
    }

    /* Place moon hints */
    this.placeMoonGossip(world);
  }

  private locRegion(loc: string | null) {
    if (loc === null) {
      return 'NONE';
    }
    return this.state.world.regions[loc];
  }

  markLocation(location: Location | null) {
    if (location === null) {
      return;
    }
    this.hintedLocations.add(location);
  }

  private makeHints(world: number, foolish: {[k: string]: number}, ih: WorldItemHints): WorldHints {
    /* Place hints on gossip stones */
    this.placeGossips(world, foolish);

    return {
      ...ih,
      foolish,
      gossip: { ...this.gossip[world] },
    };
  }

  run() {
    this.state.monitor.log('Logic: Hints');
    const worldFoolish: {[k: string]: number}[] = [];
    const worldItemHints: WorldItemHints[] = [];

    /* Mark static hints */
    for (let world = 0; world < this.state.settings.players; ++world) {
      FIXED_HINTS_LOCATIONS.forEach(x => this.hintedLocations.add(makeLocation(x, world)));
    }

    /* Compute foolish */
    for (let world = 0; world < this.state.settings.players; ++world) {
      worldFoolish.push(this.foolishRegions(world));
    }

    /* Compute item hints */
    for (let world = 0; world < this.state.settings.players; ++world) {
      const locDungeonRewards = DUNGEON_REWARDS_ORDERED.map(item => this.findItem(makeItem(item, world)));
      const locLightArrow = this.findItem(makeItem('OOT_ARROW_LIGHT', world)) || this.findItem(makeItem('SHARED_ARROW_LIGHT', world));
      const locOathToOrder = this.findItem(makeItem('MM_SONG_ORDER', world));
      const locGanonBossKey = this.state.settings.ganonBossKey === 'anywhere' ? this.findItem(makeItem('OOT_BOSS_KEY_GANON', world)) : null;

      for (const l of [...locDungeonRewards, locLightArrow, locOathToOrder, locGanonBossKey]) {
        this.markLocation(l);
      }

      worldItemHints.push({
        dungeonRewards: locDungeonRewards.map((x) => this.toRegion(world, x)),
        lightArrow: this.toRegion(world, locLightArrow),
        oathToOrder: this.toRegion(world, locOathToOrder),
        ganonBossKey: this.toRegion(world, locGanonBossKey),
      });
    }

    /* Place hints */
    const hints: Hints = [];
    for (let world = 0; world < this.state.settings.players; ++world) {
      hints.push(this.makeHints(world, worldFoolish[world], worldItemHints[world]));
    }

    return { hints };
  }
}