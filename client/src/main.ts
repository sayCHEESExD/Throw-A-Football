import '@fontsource/lilita-one/400.css';
import './ui/styles.css';
import { playerModelLoader } from './player/PlayerModelLoader.js';
import { Game } from './game/Game.js';
import { Bloxity } from './bloxity/Bloxity.js';
import { logger } from './util/logger.js';

const loading = document.getElementById('loading') as HTMLElement;
const message = loading.querySelector('.msg') as HTMLElement;

/**
 * The SDK starts FIRST, before any asset loads: emotes must be registered at
 * boot, ad breaks can arrive at any time, and the matchmaker request (which
 * carries Boxity's party ticket) must come after it. The game hands it its
 * real callbacks once it exists.
 */
const noop = (): void => undefined;
const bloxity = new Bloxity({
  setMasterVolume: noop,
  setMusicVolume: noop,
  setGraphicsQuality: noop,
  setShowFps: noop,
  setCameraSensitivity: noop,
  respawn: noop,
  pointerLockChanged: noop,
  playEmote: noop,
  avatarChanged: noop,
  adBreak: noop,
  chatMessage: noop,
});
bloxity.start();

const boot = async (): Promise<void> => {
  message.textContent = 'Lacing up the cleats...';
  bloxity.loadingStep('Loading the avatar');
  await Promise.all([playerModelLoader.load(), document.fonts?.load('20px "Lilita One"').catch(() => undefined)]);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, bloxity);
  game.start();
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  message.textContent = 'Finding a server...';
  try {
    await game.connect();
    loading.remove();
  } catch (error) {
    logger.error('boot', error);
    message.innerHTML = 'Could not reach the game server.<br><button class="btn green t" onclick="location.reload()">Try again</button>';
  }
};

void boot();
