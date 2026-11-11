/**
 * Leagues, opponents and how hard each stage plays.
 *
 * Every stage is one game: a single drive from your own 25. Score a
 * touchdown and you beat that opponent and move to the next stage.
 */
export interface TeamColors {
  readonly jersey: number;
  readonly trim: number;
  readonly pants: number;
  readonly helmet: number;
  readonly number: number;
}

export interface TeamDef {
  readonly name: string;
  readonly abbr: string;
  readonly colors: TeamColors;
  /** Stadium accent colour when you play at their place. */
  readonly stadium: number;
}

/** Your team. The quarterback is always the player's own avatar. */
export const HOME_TEAM: TeamDef = {
  name: 'City Comets',
  abbr: 'YOU',
  colors: { jersey: 0xf2259a, trim: 0xffffff, pants: 0x1d1530, helmet: 0xf2259a, number: 0xffffff },
  stadium: 0xf2259a,
};

export const LEAGUES: readonly string[] = ['Rookie League', 'Varsity League', 'Pro League', 'Elite League', 'Legend League'];
export const STAGES_PER_LEAGUE = 5;

export const OPPONENTS: readonly TeamDef[] = [
  { name: 'Harbor Sharks', abbr: 'SHK', colors: { jersey: 0x1f7cff, trim: 0x9be7ff, pants: 0xffffff, helmet: 0x1f7cff, number: 0xffffff }, stadium: 0x2c8cff },
  { name: 'Desert Scorpions', abbr: 'SCP', colors: { jersey: 0xd9b45a, trim: 0x1d1d1d, pants: 0x1d1d1d, helmet: 0xd9b45a, number: 0x1d1d1d }, stadium: 0xd9a940 },
  { name: 'Iron Wolves', abbr: 'WLF', colors: { jersey: 0x50565f, trim: 0xff8a1f, pants: 0x2a2d33, helmet: 0x50565f, number: 0xff8a1f }, stadium: 0xff8a1f },
  { name: 'Lime Lizards', abbr: 'LIZ', colors: { jersey: 0x7bd62c, trim: 0x173d12, pants: 0xffffff, helmet: 0x173d12, number: 0x173d12 }, stadium: 0x5cc83a },
  { name: 'Frost Yetis', abbr: 'YET', colors: { jersey: 0xe9f4ff, trim: 0x2d6cd8, pants: 0x2d6cd8, helmet: 0xe9f4ff, number: 0x2d6cd8 }, stadium: 0x7fc4ff },
  { name: 'Volt Falcons', abbr: 'VLT', colors: { jersey: 0xffd21f, trim: 0x111111, pants: 0x111111, helmet: 0x111111, number: 0x111111 }, stadium: 0xffd21f },
  { name: 'Crimson Bison', abbr: 'BIS', colors: { jersey: 0xc8102e, trim: 0xffffff, pants: 0xf0e6d2, helmet: 0xc8102e, number: 0xffffff }, stadium: 0xd8263f },
  { name: 'Midnight Owls', abbr: 'OWL', colors: { jersey: 0x24216b, trim: 0xb18cff, pants: 0x24216b, helmet: 0xb18cff, number: 0xffffff }, stadium: 0x6b5cff },
  { name: 'Canyon Coyotes', abbr: 'COY', colors: { jersey: 0xd2602b, trim: 0x3b1f12, pants: 0x3b1f12, helmet: 0xd2602b, number: 0xffffff }, stadium: 0xe2783d },
  { name: 'Harbor Krakens', abbr: 'KRK', colors: { jersey: 0x0f8f8a, trim: 0xffffff, pants: 0x0b3b3a, helmet: 0x0f8f8a, number: 0xffffff }, stadium: 0x18b8b0 },
];

export interface StageInfo {
  readonly stage: number;
  readonly league: string;
  readonly opponent: TeamDef;
  readonly difficulty: Difficulty;
}

export interface Difficulty {
  /** Defender top speed as a fraction of a receiver's. */
  readonly coverSpeed: number;
  /** Seconds a defender lags behind a receiver's cut. */
  readonly reaction: number;
  /** Yards of cushion a man defender gives at the snap. */
  readonly cushion: number;
  /** Seconds before the pass rush gets home (before upgrades). */
  readonly pocket: number;
  /** Pursuit speed after a catch, fraction of the carrier's. */
  readonly pursuit: number;
  /** 0..1, how good defenders are at playing the ball when close. */
  readonly ballSkill: number;
  /** A tighter, faster deep safety from this stage on (a softer one before). */
  readonly safety: boolean;
  /** Receiver run speed, units/s. */
  readonly receiverSpeed: number;
}

export const stageInfo = (stage: number): StageInfo => {
  const s = Math.max(1, Math.floor(stage));
  const i = s - 1;
  const league = LEAGUES[Math.min(LEAGUES.length - 1, Math.floor(i / STAGES_PER_LEAGUE))] as string;
  const opponent = OPPONENTS[i % OPPONENTS.length] as TeamDef;
  const t = Math.min(1, i / 22);
  return {
    stage: s,
    league,
    opponent,
    difficulty: {
      coverSpeed: 0.8 + 0.2 * t,
      reaction: 0.42 - 0.24 * t,
      cushion: 4 - 2 * t,
      pocket: 5.2 - 1.6 * t,
      pursuit: 0.95 + 0.12 * t,
      ballSkill: 0.15 + 0.45 * t,
      safety: s >= 3,
      receiverSpeed: 15.5 + 1.5 * t,
    },
  };
};
