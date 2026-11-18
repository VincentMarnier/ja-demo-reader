import type { DemoGameSummary, DemoSwingEvent } from './types';

/** Server-time span of one player record; a slot can be reused after a leave. */
export interface SwingWindow {
  from: number;
  to: number;
}

function inWindow(swing: DemoSwingEvent, window?: SwingWindow): boolean {
  if (!window) return true;
  return swing.time >= window.from && swing.time <= window.to;
}

/**
 * The numeric `LS_*` saber moves that entityState.saberMove can carry, with the
 * labels the player detail view uses. Attack moves are the ones the scan
 * records as swings; chain/recovery/defence never appear as swings but are
 * included so unknown values can be named instead of shown as numbers.
 *
 * Generated from saberMoveData[] in OpenJK's game/bg_saber.c (pinned
 * revision). The seven basic attacks are named after the input direction the
 * server resolves them from.
 */
export type SaberMoveKind = 'attack' | 'special' | 'chain' | 'recovery' | 'defence' | 'idle' | 'other';

export interface SaberMoveInfo {
  id: number;
  label: string;
  kind: SaberMoveKind;
  /** The upstream saberMoveData name, for debugging. */
  name: string;
  /** Upstream start/end quadrant, when the move has one. */
  quad: string;
}

export const SABER_MOVES: SaberMoveInfo[] = [
  { id: 0, label: 'None', kind: 'idle', name: 'None', quad: 'Q_R->Q_R' },
  { id: 1, label: 'Ready', kind: 'idle', name: 'Ready', quad: 'Q_R->Q_R' },
  { id: 2, label: 'Draw', kind: 'idle', name: 'Draw', quad: 'Q_R->Q_R' },
  { id: 3, label: 'Put away', kind: 'idle', name: 'Putaway', quad: 'Q_R->Q_R' },
  { id: 4, label: 'Forward-right', kind: 'attack', name: 'TL2BR Att', quad: 'Q_TL->Q_BR' },
  { id: 5, label: 'Right', kind: 'attack', name: 'L2R Att', quad: 'Q_L->Q_R' },
  { id: 6, label: 'Backward-right', kind: 'attack', name: 'BL2TR Att', quad: 'Q_BL->Q_TR' },
  { id: 7, label: 'Backward-left', kind: 'attack', name: 'BR2TL Att', quad: 'Q_BR->Q_TL' },
  { id: 8, label: 'Left', kind: 'attack', name: 'R2L Att', quad: 'Q_R->Q_L' },
  { id: 9, label: 'Forward-left', kind: 'attack', name: 'TR2BL Att', quad: 'Q_TR->Q_BL' },
  { id: 10, label: 'Forward', kind: 'attack', name: 'T2B Att', quad: 'Q_T->Q_B' },
  { id: 11, label: 'Back stab', kind: 'special', name: 'Back Stab', quad: 'Q_R->Q_R' },
  { id: 12, label: 'Back attack', kind: 'special', name: 'Back Att', quad: 'Q_R->Q_R' },
  { id: 13, label: 'Crouch back attack', kind: 'special', name: 'CR Back Att', quad: 'Q_R->Q_R' },
  { id: 14, label: 'Roll stab', kind: 'special', name: 'RollStab', quad: 'Q_R->Q_R' },
  { id: 15, label: 'Lunge', kind: 'special', name: 'Lunge Att', quad: 'Q_B->Q_T' },
  { id: 16, label: 'Jump attack (DFA)', kind: 'special', name: 'Jump Att', quad: 'Q_T->Q_B' },
  { id: 17, label: 'Flip stab', kind: 'special', name: 'Flip Stab', quad: 'Q_R->Q_T' },
  { id: 18, label: 'Flip slash', kind: 'special', name: 'Flip Slash', quad: 'Q_L->Q_R' },
  { id: 19, label: 'Dual jump attack', kind: 'special', name: 'DualJump Atk', quad: 'Q_R->Q_BL' },
  { id: 20, label: 'Aerial left', kind: 'special', name: 'DualJumpAtkL_A', quad: 'Q_R->Q_TL' },
  { id: 21, label: 'Aerial right', kind: 'special', name: 'DualJumpAtkR_A', quad: 'Q_R->Q_TR' },
  { id: 22, label: 'Cartwheel left', kind: 'special', name: 'DualJumpAtkL_A', quad: 'Q_R->Q_TL' },
  { id: 23, label: 'Cartwheel right', kind: 'special', name: 'DualJumpAtkR_A', quad: 'Q_R->Q_TR' },
  { id: 24, label: 'Staff butterfly left', kind: 'special', name: 'DualJumpAtkLStaff', quad: 'Q_R->Q_L' },
  { id: 25, label: 'Staff butterfly right', kind: 'special', name: 'DualJumpAtkRStaff', quad: 'Q_R->Q_R' },
  { id: 26, label: 'Butterfly left', kind: 'special', name: 'ButterflyLeft', quad: 'Q_R->Q_L' },
  { id: 27, label: 'Butterfly right', kind: 'special', name: 'ButterflyRight', quad: 'Q_R->Q_R' },
  { id: 28, label: 'Backflip attack', kind: 'special', name: 'BkFlip Atk', quad: 'Q_B->Q_T' },
  { id: 29, label: 'Dual spin attack', kind: 'special', name: 'DualSpinAtk', quad: 'Q_R->Q_R' },
  { id: 30, label: 'Staff spin attack', kind: 'special', name: 'StfSpinAtk', quad: 'Q_L->Q_R' },
  { id: 31, label: 'Long leap attack', kind: 'special', name: 'LngLeapAtk', quad: 'Q_R->Q_L' },
  { id: 32, label: 'Swoop attack (right)', kind: 'special', name: 'SwoopAtkR', quad: 'Q_R->Q_T' },
  { id: 33, label: 'Swoop attack (left)', kind: 'special', name: 'SwoopAtkL', quad: 'Q_L->Q_T' },
  { id: 34, label: 'Tauntaun attack (right)', kind: 'special', name: 'TauntaunAtkR', quad: 'Q_R->Q_T' },
  { id: 35, label: 'Tauntaun attack (left)', kind: 'special', name: 'TauntaunAtkL', quad: 'Q_L->Q_T' },
  { id: 36, label: 'Kick (forward)', kind: 'special', name: 'StfKickFwd', quad: 'Q_R->Q_R' },
  { id: 37, label: 'Kick (back)', kind: 'special', name: 'StfKickBack', quad: 'Q_R->Q_R' },
  { id: 38, label: 'Kick (right)', kind: 'special', name: 'StfKickRight', quad: 'Q_R->Q_R' },
  { id: 39, label: 'Kick (left)', kind: 'special', name: 'StfKickLeft', quad: 'Q_R->Q_R' },
  { id: 40, label: 'Kick (spin)', kind: 'special', name: 'StfKickSpin', quad: 'Q_R->Q_R' },
  { id: 41, label: 'Kick (back-forward)', kind: 'special', name: 'StfKickBkFwd', quad: 'Q_R->Q_R' },
  { id: 42, label: 'Kick (split)', kind: 'special', name: 'StfKickSplit', quad: 'Q_R->Q_R' },
  { id: 43, label: 'Kick (air, forward)', kind: 'special', name: 'StfKickFwdAir', quad: 'Q_R->Q_R' },
  { id: 44, label: 'Kick (air, back)', kind: 'special', name: 'StfKickBackAir', quad: 'Q_R->Q_R' },
  { id: 45, label: 'Kick (air, right)', kind: 'special', name: 'StfKickRightAir', quad: 'Q_R->Q_R' },
  { id: 46, label: 'Kick (air, left)', kind: 'special', name: 'StfKickLeftAir', quad: 'Q_R->Q_R' },
  { id: 47, label: 'Stab down', kind: 'special', name: 'StabDown', quad: 'Q_R->Q_R' },
  { id: 48, label: 'Stab down (staff)', kind: 'special', name: 'StabDownStf', quad: 'Q_R->Q_R' },
  { id: 49, label: 'Stab down (dual)', kind: 'special', name: 'StabDownDual', quad: 'Q_R->Q_R' },
  { id: 50, label: 'Dual spin protect', kind: 'special', name: 'dualspinprot', quad: 'Q_R->Q_R' },
  { id: 51, label: 'Staff kata', kind: 'special', name: 'StfSoulCal', quad: 'Q_R->Q_R' },
  { id: 52, label: 'Kata (fast)', kind: 'special', name: 'specialfast', quad: 'Q_R->Q_R' },
  { id: 53, label: 'Kata (medium)', kind: 'special', name: 'specialmed', quad: 'Q_R->Q_R' },
  { id: 54, label: 'Kata (strong)', kind: 'special', name: 'specialstr', quad: 'Q_R->Q_R' },
  { id: 55, label: 'Upside-down attack', kind: 'special', name: 'upsidedwnatk', quad: 'Q_R->Q_R' },
  { id: 56, label: 'Pull attack (stab)', kind: 'special', name: 'pullatkstab', quad: 'Q_R->Q_R' },
  { id: 57, label: 'Pull attack (swing)', kind: 'special', name: 'pullatkswing', quad: 'Q_R->Q_R' },
  { id: 58, label: 'Alora spin attack', kind: 'special', name: 'AloraSpinAtk', quad: 'Q_R->Q_R' },
  { id: 59, label: 'Dual front-back attack', kind: 'special', name: 'Dual FB Atk', quad: 'Q_R->Q_R' },
  { id: 60, label: 'Dual left-right attack', kind: 'special', name: 'Dual LR Atk', quad: 'Q_R->Q_R' },
  { id: 61, label: 'Hilt bash', kind: 'special', name: 'StfHiltBash', quad: 'Q_R->Q_R' },
  { id: 62, label: 'Forward-right', kind: 'attack', name: 'TL2BR St', quad: 'Q_R->Q_TL' },
  { id: 63, label: 'Right', kind: 'attack', name: 'L2R St', quad: 'Q_R->Q_L' },
  { id: 64, label: 'Backward-right', kind: 'attack', name: 'BL2TR St', quad: 'Q_R->Q_BL' },
  { id: 65, label: 'Backward-left', kind: 'attack', name: 'BR2TL St', quad: 'Q_R->Q_BR' },
  { id: 66, label: 'Left', kind: 'attack', name: 'R2L St', quad: 'Q_R->Q_R' },
  { id: 67, label: 'Forward-left', kind: 'attack', name: 'TR2BL St', quad: 'Q_R->Q_TR' },
  { id: 68, label: 'Forward', kind: 'attack', name: 'T2B St', quad: 'Q_R->Q_T' },
  { id: 69, label: 'TL → BR (recovery)', kind: 'recovery', name: 'TL2BR Ret', quad: 'Q_BR->Q_R' },
  { id: 70, label: 'L → R (recovery)', kind: 'recovery', name: 'L2R Ret', quad: 'Q_R->Q_R' },
  { id: 71, label: 'BL → TR (recovery)', kind: 'recovery', name: 'BL2TR Ret', quad: 'Q_TR->Q_R' },
  { id: 72, label: 'BR → TL (recovery)', kind: 'recovery', name: 'BR2TL Ret', quad: 'Q_TL->Q_R' },
  { id: 73, label: 'R → L (recovery)', kind: 'recovery', name: 'R2L Ret', quad: 'Q_L->Q_R' },
  { id: 74, label: 'TR → BL (recovery)', kind: 'recovery', name: 'TR2BL Ret', quad: 'Q_BL->Q_R' },
  { id: 75, label: 'T → B (recovery)', kind: 'recovery', name: 'T2B Ret', quad: 'Q_B->Q_R' },
  { id: 76, label: 'BR → R (chain)', kind: 'chain', name: 'BR2R Trans', quad: 'Q_BR->Q_R' },
  { id: 77, label: 'BR → TR (chain)', kind: 'chain', name: 'BR2TR Trans', quad: 'Q_BR->Q_TR' },
  { id: 78, label: 'BR → T (chain)', kind: 'chain', name: 'BR2T Trans', quad: 'Q_BR->Q_T' },
  { id: 79, label: 'BR → TL (chain)', kind: 'chain', name: 'BR2TL Trans', quad: 'Q_BR->Q_TL' },
  { id: 80, label: 'BR → L (chain)', kind: 'chain', name: 'BR2L Trans', quad: 'Q_BR->Q_L' },
  { id: 81, label: 'BR → BL (chain)', kind: 'chain', name: 'BR2BL Trans', quad: 'Q_BR->Q_BL' },
  { id: 82, label: 'R → BR (chain)', kind: 'chain', name: 'R2BR Trans', quad: 'Q_R->Q_BR' },
  { id: 83, label: 'R → TR (chain)', kind: 'chain', name: 'R2TR Trans', quad: 'Q_R->Q_TR' },
  { id: 84, label: 'R → T (chain)', kind: 'chain', name: 'R2T Trans', quad: 'Q_R->Q_T' },
  { id: 85, label: 'R → TL (chain)', kind: 'chain', name: 'R2TL Trans', quad: 'Q_R->Q_TL' },
  { id: 86, label: 'R → L (chain)', kind: 'chain', name: 'R2L Trans', quad: 'Q_R->Q_L' },
  { id: 87, label: 'R → BL (chain)', kind: 'chain', name: 'R2BL Trans', quad: 'Q_R->Q_BL' },
  { id: 88, label: 'TR → BR (chain)', kind: 'chain', name: 'TR2BR Trans', quad: 'Q_TR->Q_BR' },
  { id: 89, label: 'TR → R (chain)', kind: 'chain', name: 'TR2R Trans', quad: 'Q_TR->Q_R' },
  { id: 90, label: 'TR → T (chain)', kind: 'chain', name: 'TR2T Trans', quad: 'Q_TR->Q_T' },
  { id: 91, label: 'TR → TL (chain)', kind: 'chain', name: 'TR2TL Trans', quad: 'Q_TR->Q_TL' },
  { id: 92, label: 'TR → L (chain)', kind: 'chain', name: 'TR2L Trans', quad: 'Q_TR->Q_L' },
  { id: 93, label: 'TR → BL (chain)', kind: 'chain', name: 'TR2BL Trans', quad: 'Q_TR->Q_BL' },
  { id: 94, label: 'T → BR (chain)', kind: 'chain', name: 'T2BR Trans', quad: 'Q_T->Q_BR' },
  { id: 95, label: 'T → R (chain)', kind: 'chain', name: 'T2R Trans', quad: 'Q_T->Q_R' },
  { id: 96, label: 'T → TR (chain)', kind: 'chain', name: 'T2TR Trans', quad: 'Q_T->Q_TR' },
  { id: 97, label: 'T → TL (chain)', kind: 'chain', name: 'T2TL Trans', quad: 'Q_T->Q_TL' },
  { id: 98, label: 'T → L (chain)', kind: 'chain', name: 'T2L Trans', quad: 'Q_T->Q_L' },
  { id: 99, label: 'T → BL (chain)', kind: 'chain', name: 'T2BL Trans', quad: 'Q_T->Q_BL' },
  { id: 100, label: 'TL → BR (chain)', kind: 'chain', name: 'TL2BR Trans', quad: 'Q_TL->Q_BR' },
  { id: 101, label: 'TL → R (chain)', kind: 'chain', name: 'TL2R Trans', quad: 'Q_TL->Q_R' },
  { id: 102, label: 'TL → TR (chain)', kind: 'chain', name: 'TL2TR Trans', quad: 'Q_TL->Q_TR' },
  { id: 103, label: 'TL → T (chain)', kind: 'chain', name: 'TL2T Trans', quad: 'Q_TL->Q_T' },
  { id: 104, label: 'TL → L (chain)', kind: 'chain', name: 'TL2L Trans', quad: 'Q_TL->Q_L' },
  { id: 105, label: 'TL → BL (chain)', kind: 'chain', name: 'TL2BL Trans', quad: 'Q_TL->Q_BL' },
  { id: 106, label: 'L → BR (chain)', kind: 'chain', name: 'L2BR Trans', quad: 'Q_L->Q_BR' },
  { id: 107, label: 'L → R (chain)', kind: 'chain', name: 'L2R Trans', quad: 'Q_L->Q_R' },
  { id: 108, label: 'L → TR (chain)', kind: 'chain', name: 'L2TR Trans', quad: 'Q_L->Q_TR' },
  { id: 109, label: 'L → T (chain)', kind: 'chain', name: 'L2T Trans', quad: 'Q_L->Q_T' },
  { id: 110, label: 'L → TL (chain)', kind: 'chain', name: 'L2TL Trans', quad: 'Q_L->Q_TL' },
  { id: 111, label: 'L → BL (chain)', kind: 'chain', name: 'L2BL Trans', quad: 'Q_L->Q_BL' },
  { id: 112, label: 'BL → BR (chain)', kind: 'chain', name: 'BL2BR Trans', quad: 'Q_BL->Q_BR' },
  { id: 113, label: 'BL → R (chain)', kind: 'chain', name: 'BL2R Trans', quad: 'Q_BL->Q_R' },
  { id: 114, label: 'BL → TR (chain)', kind: 'chain', name: 'BL2TR Trans', quad: 'Q_BL->Q_TR' },
  { id: 115, label: 'BL → T (chain)', kind: 'chain', name: 'BL2T Trans', quad: 'Q_BL->Q_T' },
  { id: 116, label: 'BL → TL (chain)', kind: 'chain', name: 'BL2TL Trans', quad: 'Q_BL->Q_TL' },
  { id: 117, label: 'BL → L (chain)', kind: 'chain', name: 'BL2L Trans', quad: 'Q_BL->Q_L' },
  { id: 118, label: 'Bounce BR', kind: 'defence', name: 'Bounce BR', quad: 'Q_BR->Q_BR' },
  { id: 119, label: 'Bounce R', kind: 'defence', name: 'Bounce R', quad: 'Q_R->Q_R' },
  { id: 120, label: 'Bounce TR', kind: 'defence', name: 'Bounce TR', quad: 'Q_TR->Q_TR' },
  { id: 121, label: 'Bounce T', kind: 'defence', name: 'Bounce T', quad: 'Q_T->Q_T' },
  { id: 122, label: 'Bounce TL', kind: 'defence', name: 'Bounce TL', quad: 'Q_TL->Q_TL' },
  { id: 123, label: 'Bounce L', kind: 'defence', name: 'Bounce L', quad: 'Q_L->Q_L' },
  { id: 124, label: 'Bounce BL', kind: 'defence', name: 'Bounce BL', quad: 'Q_BL->Q_BL' },
  { id: 125, label: 'Deflect BR', kind: 'defence', name: 'Deflect BR', quad: 'Q_BR->Q_BR' },
  { id: 126, label: 'Deflect R', kind: 'defence', name: 'Deflect R', quad: 'Q_R->Q_R' },
  { id: 127, label: 'Deflect TR', kind: 'defence', name: 'Deflect TR', quad: 'Q_TR->Q_TR' },
  { id: 128, label: 'Deflect T', kind: 'defence', name: 'Deflect T', quad: 'Q_T->Q_T' },
  { id: 129, label: 'Deflect TL', kind: 'defence', name: 'Deflect TL', quad: 'Q_TL->Q_TL' },
  { id: 130, label: 'Deflect L', kind: 'defence', name: 'Deflect L', quad: 'Q_L->Q_L' },
  { id: 131, label: 'Deflect BL', kind: 'defence', name: 'Deflect BL', quad: 'Q_BL->Q_BL' },
  { id: 132, label: 'Deflect B', kind: 'defence', name: 'Deflect B', quad: 'Q_B->Q_B' },
  { id: 133, label: 'Reflected BR', kind: 'defence', name: 'Reflected BR', quad: 'Q_BR->Q_BR' },
  { id: 134, label: 'Reflected R', kind: 'defence', name: 'Reflected R', quad: 'Q_R->Q_R' },
  { id: 135, label: 'Reflected TR', kind: 'defence', name: 'Reflected TR', quad: 'Q_TR->Q_TR' },
  { id: 136, label: 'Reflected T', kind: 'defence', name: 'Reflected T', quad: 'Q_T->Q_T' },
  { id: 137, label: 'Reflected TL', kind: 'defence', name: 'Reflected TL', quad: 'Q_TL->Q_TL' },
  { id: 138, label: 'Reflected L', kind: 'defence', name: 'Reflected L', quad: 'Q_L->Q_L' },
  { id: 139, label: 'Reflected BL', kind: 'defence', name: 'Reflected BL', quad: 'Q_BL->Q_BL' },
  { id: 140, label: 'Reflected B', kind: 'defence', name: 'Reflected B', quad: 'Q_B->Q_B' },
  { id: 141, label: 'BParry Top', kind: 'defence', name: 'BParry Top', quad: 'Q_T->Q_B' },
  { id: 142, label: 'BParry UR', kind: 'defence', name: 'BParry UR', quad: 'Q_TR->Q_BL' },
  { id: 143, label: 'BParry UL', kind: 'defence', name: 'BParry UL', quad: 'Q_TL->Q_BR' },
  { id: 144, label: 'BParry LR', kind: 'defence', name: 'BParry LR', quad: 'Q_BL->Q_TR' },
  { id: 145, label: 'BParry Bot', kind: 'defence', name: 'BParry Bot', quad: 'Q_B->Q_T' },
  { id: 146, label: 'BParry LL', kind: 'defence', name: 'BParry LL', quad: 'Q_BR->Q_TL' },
  { id: 147, label: 'Knock Top', kind: 'defence', name: 'Knock Top', quad: 'Q_R->Q_T' },
  { id: 148, label: 'Knock UR', kind: 'defence', name: 'Knock UR', quad: 'Q_R->Q_TR' },
  { id: 149, label: 'Knock UL', kind: 'defence', name: 'Knock UL', quad: 'Q_R->Q_TL' },
  { id: 150, label: 'Knock LR', kind: 'defence', name: 'Knock LR', quad: 'Q_R->Q_BL' },
  { id: 151, label: 'Knock LL', kind: 'defence', name: 'Knock LL', quad: 'Q_R->Q_BR' },
  { id: 152, label: 'Parry Top', kind: 'defence', name: 'Parry Top', quad: 'Q_R->Q_T' },
  { id: 153, label: 'Parry UR', kind: 'defence', name: 'Parry UR', quad: 'Q_R->Q_TL' },
  { id: 154, label: 'Parry UL', kind: 'defence', name: 'Parry UL', quad: 'Q_R->Q_TR' },
  { id: 155, label: 'Parry LR', kind: 'defence', name: 'Parry LR', quad: 'Q_R->Q_BR' },
  { id: 156, label: 'Parry LL', kind: 'defence', name: 'Parry LL', quad: 'Q_R->Q_BL' },
  { id: 157, label: 'Reflect Top', kind: 'defence', name: 'Reflect Top', quad: 'Q_R->Q_T' },
  { id: 158, label: 'Reflect UR', kind: 'defence', name: 'Reflect UR', quad: 'Q_R->Q_TR' },
  { id: 159, label: 'Reflect UL', kind: 'defence', name: 'Reflect UL', quad: 'Q_R->Q_TL' },
  { id: 160, label: 'Reflect LR', kind: 'defence', name: 'Reflect LR', quad: 'Q_R->Q_BL' },
  { id: 161, label: 'Reflect LL', kind: 'defence', name: 'Reflect LL', quad: 'Q_R->Q_BR' },];

const SABER_MOVES_BY_ID = new Map(SABER_MOVES.map(move => [move.id, move]));

export function saberMoveInfo(move: number): SaberMoveInfo {
  return (
    SABER_MOVES_BY_ID.get(move) ?? {
      id: move,
      label: `Move ${move}`,
      kind: 'other',
      name: `LS_${move}`,
      quad: ''
    }
  );
}

export function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

export type SaberStyle = 'none' | 'single' | 'dual' | 'staff' | 'custom';

/** The base saber type encoded in the clientinfo saber name. */
export function saberStyle(name: string): SaberStyle {
  const value = name.toLowerCase();
  if (!value || value === 'none') return 'none';
  if (value.startsWith('dual_')) return 'dual';
  if (value.startsWith('staff_')) return 'staff';
  if (value.startsWith('single_')) return 'single';
  return 'custom';
}

export function saberLabel(name: string): string {
  switch (saberStyle(name)) {
    case 'none':
      return 'No saber';
    case 'single':
      return 'Single saber';
    case 'dual':
      return 'Dual sabers';
    case 'staff':
      return 'Saber staff';
    default:
      return !name || name === 'unknown' ? 'Unknown saber' : stripColors(name);
  }
}

export function stanceLabel(stance: number): string {
  switch (stance) {
    case 0:
      return 'No stance';
    case 1:
      return 'Fast';
    case 2:
      return 'Medium';
    case 3:
      return 'Strong';
    case 4:
      return 'Desann';
    case 5:
      return 'Tavion';
    case 6:
      return 'Dual';
    case 7:
      return 'Staff';
    default:
      return `Style ${stance}`;
  }
}

export function playerLabel(game: DemoGameSummary, num: number): string {
  if (num < 0) return 'Unknown source';
  const record = game.players.find(player => player.num === num);
  return record ? stripColors(record.name) || `Client ${num}` : `Client ${num}`;
}

export interface SaberTypeStats {
  move: number;
  label: string;
  kind: SaberMoveKind;
  swings: number;
  successful: number;
  hits: number;
  damage: number;
  /** Damage of each swing that the demo attributed damage to. */
  samples: number[];
}

export interface SaberComboStats {
  key: string;
  saber: number;
  saberName: string;
  saberLabel: string;
  stance: number;
  stanceLabel: string;
  swings: number;
  successful: number;
  hits: number;
  damage: number;
  samples: number[];
  types: SaberTypeStats[];
}

/** Groups one player's swings by saber and stance, then by swing type. */
export function playerCombos(game: DemoGameSummary, num: number, window?: SwingWindow): SaberComboStats[] {
  const sabers = new Map((game.sabers ?? []).map(saber => [saber.id, saber.name]));
  const combos = new Map<string, SaberComboStats>();

  for (const swing of game.swings ?? []) {
    if (swing.num !== num || !inWindow(swing, window)) continue;
    const saberName = sabers.get(swing.saber) ?? 'unknown';
    const key = `${swing.saber}:${swing.stance}`;
    let combo = combos.get(key);
    if (!combo) {
      combo = {
        key,
        saber: swing.saber,
        saberName,
        saberLabel: saberLabel(saberName),
        stance: swing.stance,
        stanceLabel: stanceLabel(swing.stance),
        swings: 0,
        successful: 0,
        hits: 0,
        damage: 0,
        samples: [],
        types: []
      };
      combos.set(key, combo);
    }
    combo.swings++;
    combo.hits += swing.hits;
    combo.damage += swing.damage;
    if (swing.hits > 0) combo.successful++;
    if (swing.damage > 0) combo.samples.push(swing.damage);

    let type = combo.types.find(entry => entry.move === swing.move);
    if (!type) {
      const info = saberMoveInfo(swing.move);
      type = {
        move: swing.move,
        label: info.label,
        kind: info.kind,
        swings: 0,
        successful: 0,
        hits: 0,
        damage: 0,
        samples: []
      };
      combo.types.push(type);
    }
    type.swings++;
    type.hits += swing.hits;
    type.damage += swing.damage;
    if (swing.hits > 0) type.successful++;
    if (swing.damage > 0) type.samples.push(swing.damage);
  }

  const result = [...combos.values()];
  for (const combo of result) {
    combo.types.sort((a, b) => b.swings - a.swings || b.hits - a.hits);
  }
  result.sort((a, b) => b.swings - a.swings || a.saberName.localeCompare(b.saberName));
  return result;
}

export interface SwingTotals {
  swings: number;
  successful: number;
  hits: number;
  damage: number;
  samples: number[];
}

export function swingTotals(combos: SaberComboStats[]): SwingTotals {
  const totals: SwingTotals = { swings: 0, successful: 0, hits: 0, damage: 0, samples: [] };
  for (const combo of combos) {
    totals.swings += combo.swings;
    totals.successful += combo.successful;
    totals.hits += combo.hits;
    totals.damage += combo.damage;
    totals.samples.push(...combo.samples);
  }
  return totals;
}

export function successRate(successful: number, swings: number): number {
  return swings > 0 ? successful / swings : 0;
}

export function meanValue(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function medianValue(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export interface SwingBucket {
  /** Milliseconds since the game started. */
  time: number;
  end: number;
  swings: number;
  successful: number;
  hits: number;
}

/** Fixed-width buckets of one player's swings, for the success-rate chart. */
export function swingBuckets(
  game: DemoGameSummary,
  num: number,
  bucketMs: number,
  keep?: (swing: DemoSwingEvent) => boolean,
  window?: SwingWindow
): SwingBucket[] {
  const duration = Math.max(1, game.duration);
  const count = Math.max(1, Math.ceil(duration / bucketMs));
  const buckets: SwingBucket[] = Array.from({ length: count }, (_, index) => ({
    time: index * bucketMs,
    end: Math.min(duration, (index + 1) * bucketMs),
    swings: 0,
    successful: 0,
    hits: 0
  }));

  for (const swing of game.swings ?? []) {
    if (swing.num !== num) continue;
    if (keep && !keep(swing)) continue;
    if (!inWindow(swing, window)) continue;
    const relative = Math.min(duration, Math.max(0, swing.time - game.startTime));
    const index = Math.min(count - 1, Math.floor(relative / bucketMs));
    const bucket = buckets[index];
    bucket.swings++;
    bucket.hits += swing.hits;
    if (swing.hits > 0) bucket.successful++;
  }
  return buckets;
}

export interface DamageSeriesPoint {
  time: number;
  value: number;
}

export interface OpponentDamage {
  num: number;
  name: string;
  given: number;
  received: number;
  /** Cumulative damage this player dealt to that opponent. */
  givenSeries: DamageSeriesPoint[];
  /** Cumulative damage this player received from that opponent. */
  receivedSeries: DamageSeriesPoint[];
}

function pushPoint(points: DamageSeriesPoint[], time: number, value: number) {
  const last = points[points.length - 1];
  if (last && last.time === time) last.value = value;
  else points.push({ time, value });
}

/**
 * Cumulative damage between one player and every other player, including the
 * damage the demo could not attribute to anyone (`num` -1).
 */
export function opponentDamage(game: DemoGameSummary, num: number, window?: SwingWindow): OpponentDamage[] {
  const given = new Map<number, OpponentDamage>();
  const received = new Map<number, OpponentDamage>();
  const duration = Math.max(1, game.duration);

  const ensure = (map: Map<number, OpponentDamage>, other: number): OpponentDamage => {
    let entry = map.get(other);
    if (!entry) {
      entry = {
        num: other,
        name: playerLabel(game, other),
        given: 0,
        received: 0,
        givenSeries: [{ time: 0, value: 0 }],
        receivedSeries: [{ time: 0, value: 0 }]
      };
      map.set(other, entry);
    }
    return entry;
  };

  for (const damage of game.damages ?? []) {
    if (damage.damage <= 0) continue;
    if (window && (damage.time < window.from || damage.time > window.to)) continue;
    const time = Math.min(duration, Math.max(0, damage.time - game.startTime));
    if (damage.attacker === num && damage.target !== num) {
      const entry = ensure(given, damage.target);
      entry.given += damage.damage;
      pushPoint(entry.givenSeries, time, entry.given);
    }
    if (damage.target === num) {
      const entry = ensure(received, damage.attacker);
      entry.received += damage.damage;
      pushPoint(entry.receivedSeries, time, entry.received);
    }
  }

  const players = new Map<number, string>();
  for (const player of game.players) {
    if (player.num === num) continue;
    if (player.team === 3 && player.kills === 0 && player.deaths === 0) continue;
    players.set(player.num, playerLabel(game, player.num));
  }
  for (const other of given.keys()) players.set(other, playerLabel(game, other));
  for (const other of received.keys()) {
    if (other >= 0) players.set(other, playerLabel(game, other));
  }

  const result: OpponentDamage[] = [];
  for (const other of players.keys()) {
    const givenEntry = given.get(other);
    const receivedEntry = received.get(other);
    result.push({
      num: other,
      name: playerLabel(game, other),
      given: givenEntry?.given ?? 0,
      received: receivedEntry?.received ?? 0,
      givenSeries: givenEntry?.givenSeries ?? [{ time: 0, value: 0 }],
      receivedSeries: receivedEntry?.receivedSeries ?? [{ time: 0, value: 0 }]
    });
  }
  const unknown = received.get(-1);
  if (unknown && unknown.received > 0) {
    result.push({
      num: -1,
      name: 'Unknown source',
      given: 0,
      received: unknown.received,
      givenSeries: [{ time: 0, value: 0 }],
      receivedSeries: unknown.receivedSeries
    });
  }

  for (const entry of result) {
    if (entry.givenSeries[entry.givenSeries.length - 1].time < duration) {
      entry.givenSeries.push({ time: duration, value: entry.given });
    }
    if (entry.receivedSeries[entry.receivedSeries.length - 1].time < duration) {
      entry.receivedSeries.push({ time: duration, value: entry.received });
    }
  }
  result.sort((a, b) => b.given + b.received - (a.given + a.received) || a.name.localeCompare(b.name));
  return result;
}

export interface MovementTally {
  air: number;
  ground: number;
  land: number;
}

export interface MovementCounts {
  dealt: MovementTally;
  received: MovementTally;
}

/**
 * Global damage given: damage to opponents minus damage to allies. The
 * per-opponent views stay raw and positive.
 */
export function damageGiven(game: DemoGameSummary, num: number, window?: SwingWindow): number {
  let total = 0;
  for (const damage of game.damages ?? []) {
    if (damage.damage <= 0 || damage.attacker !== num) continue;
    if (window && (damage.time < window.from || damage.time > window.to)) continue;
    total += damage.friendly ? -damage.damage : damage.damage;
  }
  return total;
}

/**
 * Saber contacts dealt and received split by the player's own movement state
 * when the hit landed: airborne, on the ground, or just after landing.
 */
export function movementCounts(game: DemoGameSummary, num: number, window?: SwingWindow): MovementCounts {
  const dealt: MovementTally = { air: 0, ground: 0, land: 0 };
  const received: MovementTally = { air: 0, ground: 0, land: 0 };
  const add = (tally: MovementTally, state: number) => {
    if (state === 1) tally.air++;
    else if (state === 2) tally.land++;
    else tally.ground++;
  };

  for (const hit of game.saberHits ?? []) {
    if (window && (hit.time < window.from || hit.time > window.to)) continue;
    if (hit.attacker === num) add(dealt, hit.attackerState);
    if (hit.target === num) add(received, hit.targetState);
  }
  return { dealt, received };
}

export interface BlockOpponentStats {
  num: number;
  name: string;
  /** Guards this player broke (this player's strike, opponent exposed). */
  won: number;
  /** Guards this player lost (opponent's strike, this player exposed). */
  lost: number;
}

export interface BlockStats {
  won: number;
  lost: number;
  opponents: BlockOpponentStats[];
}

/**
 * Broken guards won and lost against every other player. A win is a broken
 * parry (`LS_H1_*`): the loser was blocking and is left exposed. Wall bounces
 * and saber-lock losses are not guard breaks and are excluded by the scan.
 */
export function blockStats(game: DemoGameSummary, num: number, window?: SwingWindow): BlockStats {
  const byNum = new Map<number, BlockOpponentStats>();
  const ensure = (other: number): BlockOpponentStats => {
    let entry = byNum.get(other);
    if (!entry) {
      entry = { num: other, name: playerLabel(game, other), won: 0, lost: 0 };
      byNum.set(other, entry);
    }
    return entry;
  };

  for (const player of game.players) {
    if (player.num === num) continue;
    if (player.team === 3 && player.kills === 0 && player.deaths === 0) continue;
    ensure(player.num);
  }

  let won = 0;
  let lost = 0;
  for (const block of game.blocks ?? []) {
    if (window && (block.time < window.from || block.time > window.to)) continue;
    if (block.winner === num && block.loser !== num) {
      won++;
      ensure(block.loser).won++;
    } else if (block.loser === num) {
      lost++;
      if (block.winner >= 0 && block.winner !== num) ensure(block.winner).lost++;
    }
  }

  const opponents = [...byNum.values()].sort(
    (a, b) => b.won + b.lost - (a.won + a.lost) || a.name.localeCompare(b.name)
  );
  return { won, lost, opponents };
}
