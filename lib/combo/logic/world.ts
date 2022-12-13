import { Game, GAMES } from '../config';
import { gameId } from '../util';
import { Expr } from './expr';
import { ExprParser } from './expr-parser';
import { DATA_POOL, DATA_MACROS, DATA_WORLD } from '../data';
import { Constraint, itemConstraint } from './constraints';
import { Settings } from '../settings';

type ExprMap = {
  [k: string]: Expr;
}

type WorldArea = {
  locations: ExprMap;
  exits: ExprMap;
  events: ExprMap;
};

type WorldCheckNumeric = {
  type: 'chest' | 'collectible' | 'gs' | 'sf';
  id: number;
};

type WorldCheckSymbolic = {
  type: 'npc';
  id: string;
};

export type WorldCheck = {
  game: Game;
  scene: string;
  item: string;
  constraint: Constraint;
} & (WorldCheckNumeric | WorldCheckSymbolic);

export type World = {
  areas: {[k: string]: WorldArea};
  checks: {[k: string]: WorldCheck};
  dungeons: {[k: string]: Set<string>};
};

const mapExprs = (exprParser: ExprParser, game: Game, data: any) => {
  const result: ExprMap = {};
  for (const [k, v] of Object.entries(data)) {
    let name = k;
    if (!(/^(MM|OOT) /.test(name))) {
      name = gameId(game, k, ' ');
    }
    result[name] = exprParser.parse(v as string);
  }
  return result;
}

const loadWorldAreas = (world: World, game: Game, exprParser: ExprParser) => {
  const data = DATA_WORLD[game];
  for (let name in data) {
    const area = data[name];
    name = gameId(game, name, ' ');
    const dungeon = area.dungeon;
    const locations = mapExprs(exprParser, game, area.locations || {});
    const exits = mapExprs(exprParser, game, area.exits || {});
    const events = mapExprs(exprParser, game, area.events || {});

    if (name === undefined) {
      throw new Error(`Area name is undefined`);
    }

    world.areas[name] = { locations, exits, events };

    if (dungeon !== undefined) {
      if (world.dungeons[dungeon] === undefined) {
        world.dungeons[dungeon] = new Set();
      }
      const d = world.dungeons[dungeon];
      Object.keys(locations).forEach(x => d.add(x));
    }
  }
};

const loadWorldPool = (world: World, game: Game, settings: Settings) => {
  for (const record of DATA_POOL[game]) {
    const location = gameId(game, String(record.location), ' ');
    const type = String(record.type);
    const scene = gameId(game, String(record.scene), '_');
    let id = null;
    if (type === 'npc') {
      id = gameId(game, String(record.id), '_');
    } else {
      id = Number(record.id);
    }
    const item = gameId(game, String(record.item), '_');
    const constraint = itemConstraint(item, settings);

    const check = { game, type, scene, id, item, constraint } as WorldCheck;
    world.checks[location] = check;
  }
};

const loadMacros = (exprParser: ExprParser, game: Game) => {
  const data = DATA_MACROS[game];
  for (let name in data) {
    const buffer = data[name];

    /* Horrible hack */
    name = name.replace('(', ' ');
    name = name.replace(')', ' ');
    name = name.replace(',', ' ');

    const parts = name.split(' ').filter(x => !!x);
    name = parts[0];
    const args = parts.slice(1);
    exprParser.addMacro(name, args, buffer);
  }
};

const loadWorldGame = (world: World, game: Game, settings: Settings) => {
  /* Create the expr parser */
  const exprParser = new ExprParser(game);
  loadMacros(exprParser, game);
  loadWorldAreas(world, game, exprParser);
  loadWorldPool(world, game, settings);
}

export const createWorld = (settings: Settings) => {
  const world: World = { areas: {}, checks: {}, dungeons: {} };
  for (const g of GAMES) {
    loadWorldGame(world, g, settings);
  }
  return world;
};
