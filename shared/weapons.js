export const WEAPONS = {
  // Submachine Guns
  mp5: {
    id: 'mp5',
    sprite: 'mp5.png',
    damage: 15,
    cooldownMs: 80,
    range: 1200,
    spread: 0.1,
    pellets: 1,
    scale: 0.5,
  },
  uzi: {
    id: 'uzi',
    sprite: 'uzi.png',
    damage: 12,
    cooldownMs: 60,
    range: 1000,
    spread: 0.15,
    pellets: 1,
    scale: 0.5,
  },

  // Assault Rifles
  ak47: {
    id: 'ak47',
    sprite: 'ak47.png',
    damage: 25,
    cooldownMs: 120,
    range: 1500,
    spread: 0.05,
    pellets: 1,
    scale: 0.5,
  },
  m16: {
    id: 'm16',
    sprite: 'm16.png',
    damage: 20,
    cooldownMs: 100,
    range: 1600,
    spread: 0.03,
    pellets: 1,
    scale: 0.5,
  },
  m14: {
    id: 'm14',
    sprite: 'sniper.png', // m14 sprite might be missing, use sniper or tavor
    damage: 40,
    cooldownMs: 300,
    range: 2000,
    spread: 0.01,
    pellets: 1,
    scale: 0.5,
  },
  m93ba: {
    id: 'm93ba',
    sprite: 'sniper.png', // Sniper rifle
    damage: 80,
    cooldownMs: 800,
    range: 3000,
    spread: 0.005,
    pellets: 1,
    scale: 0.5,
  },

  // Heavy Weapons (Hitscan approximations for now)
  shotgun: {
    id: 'shotgun',
    sprite: 'shotgun.png',
    damage: 15, // per pellet
    cooldownMs: 600,
    range: 800,
    spread: 0.25,
    pellets: 6,
    scale: 0.5,
  },
  riot: {
    id: 'riot',
    sprite: 'shotgun.png', // Fallback
    damage: 20,
    cooldownMs: 800,
    range: 700,
    spread: 0.3,
    pellets: 8,
    scale: 0.5,
  },
  sawgun: {
    id: 'sawgun',
    sprite: 'sawgun.png',
    damage: 30, // hitscan for now
    cooldownMs: 400,
    range: 1000,
    spread: 0.05,
    pellets: 1,
    scale: 0.5,
  },
  smaw: {
    id: 'smaw',
    sprite: 'smaw.png',
    damage: 100, // hitscan railgun for now
    cooldownMs: 1200,
    range: 2500,
    spread: 0.02,
    pellets: 1,
    scale: 0.4,
  },
  flame: {
    id: 'flame',
    sprite: 'flamethrower.png',
    damage: 5,
    cooldownMs: 40,
    range: 500,
    spread: 0.2,
    pellets: 1,
    scale: 0.5,
  },

  // Sidearms
  magnum: {
    id: 'magnum',
    sprite: 'magnum.png',
    damage: 35,
    cooldownMs: 300,
    range: 1200,
    spread: 0.02,
    pellets: 1,
    scale: 0.5,
  },
};

export const DEFAULT_WEAPON = WEAPONS.magnum;
