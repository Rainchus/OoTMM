import path from 'path';
import fs from 'fs/promises';

import { compressGame } from './compress';
import { Game, GAMES, PATH_DIST, PATH_BUILD, CONFIG, CUSTOM_ADDR } from './config';
import { patchGame } from './patch';
import { DmaData } from './dma';
import { randomize } from './randomizer';
import { Options } from './options';
import { BuildOutput } from './build';
import { DecompressedRoms } from './decompress';

const combineRoms = async (roms: DecompressedRoms, build: BuildOutput, opts: Options) => {
  const [oot, mm] = await Promise.all(GAMES.map(async (g) => {
    const rom = roms[g].rom;
    const patchedRom = await patchGame(rom, build[g].patches, opts, g);
    const compressedRom = await compressGame(g, patchedRom, roms[g].dma);
    return compressedRom;
  }));
  return Buffer.concat([oot, mm]);
};

const packPayload = async (rom: Buffer, build: BuildOutput, game: Game) => {
  console.log("Packing payload for " + game + "...");
  const payload = build[game].payload;
  if (payload.length > 0x20000) {
    throw new Error("Payload too large");
  }
  const addr = CONFIG[game].payloadAddr;
  payload.copy(rom, addr);
};

const packCustom = async (rom: Buffer) => {
  console.log("Packing custom data...");
  const customData = await fs.readFile(path.resolve(PATH_BUILD, 'custom.bin'));
  if (customData.length > 0x20000) {
    throw new Error("Custom data too large");
  }
  customData.copy(rom, CUSTOM_ADDR);
};

const fixDMA = (rom: Buffer) => {
  console.log("Fixing DMA...");
  const config = CONFIG['mm'];
  const mask = 0x02000000;
  const dmaAddr = config.dmaAddr + mask;
  const dma = new DmaData(rom.subarray(dmaAddr, dmaAddr + config.dmaCount * 0x10));
  for (let i = 0; i < dma.count(); ++i) {
    const entry = dma.read(i);
    if (entry.physEnd === 0xffffffff) {
      continue;
    }
    entry.physStart = (entry.physStart | mask) >>> 0;
    if (entry.physEnd) {
      entry.physEnd = (entry.physEnd | mask) >>> 0;
    }
    dma.write(i, entry);
  }
};

const fixHeader = (rom: Buffer) => {
  console.log("Fixing the header...");
  const romName = Buffer.from('OOT+MM COMBO       ');
  romName.copy(rom, 0x20);
  const romCode = Buffer.from('ZZE');
  romCode.copy(rom, 0x3c);
};

const rol = (v: number, b: number) => (((v << b) | (v >>> (32 - b))) & 0xffffffff) >>> 0;

const checksum = (rom: Buffer) => {
  const seed = 0xdf26f436;
  let t1 = seed;
  let t2 = seed;
  let t3 = seed;
  let t4 = seed;
  let t5 = seed;
  let t6 = seed;

  for (let i = 0; i < 0x100000 / 4; ++i) {
    const offset = 0x1000 + i * 4;
    const d = rom.readUInt32BE(offset);
    if ((((t6 + d) & 0xffffffff) >>> 0) < t6) {
      t4 = ((t4 + 1) & 0xffffffff) >>> 0;
    }
    t6 = ((t6 + d) & 0xffffffff) >>> 0;
    t3 = ((t3 ^ d) & 0xffffffff) >>> 0;
    const r = rol(d, ((d & 0x1f) >>> 0));
    t5 = ((t5 + r) & 0xffffffff) >>> 0;
    if (t2 > d) {
      t2 = (t2 ^ r) >>> 0;
    } else {
      t2 = (t2 ^ t6 ^ d) >>> 0;
    }
    const offset2 = 0x750 + ((i * 4) & 0xff);
    const x = rom.readUInt32BE(offset2);
    t1 = ((t1 + ((x ^ d) >>> 0)) & 0xffffffff) >>> 0;
  }

  return [(t6 ^ t4 ^ t3) >>> 0, (t5 ^ t2 ^ t1) >>> 0];
};

const fixChecksum = (rom: Buffer) => {
  console.log("Fixing the checksum...");
  const [c1, c2] = checksum(rom);
  rom.writeUInt32BE(c1, 0x10);
  rom.writeUInt32BE(c2, 0x14);
};

export const pack = async (roms: DecompressedRoms, build: BuildOutput, opts: Options): Promise<Buffer> => {
  const rom = await combineRoms(roms, build, opts);
  fs.mkdir(PATH_DIST, { recursive: true });

  for (const g of GAMES) {
    await packPayload(rom, build, g);
  }
  await packCustom(rom);
  fixDMA(rom);
  fixHeader(rom);
  fixChecksum(rom);
  return rom;
  /*
  await fs.writeFile(path.resolve(PATH_DIST, 'spoiler.txt'), log);
  await fs.writeFile(path.resolve(PATH_DIST, 'OoTMM.z64'), rom);
  */
};
