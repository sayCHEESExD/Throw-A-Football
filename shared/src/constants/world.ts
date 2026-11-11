/**
 * World-space constants shared by the renderer and the authoritative server.
 *
 * Units are "world units" (1 unit ~= 1.5 Roblox studs). The supplied
 * player.fbx is authored at 320 units tall, so it is scaled down on load.
 */

/** Multiplier applied to the loaded FBX so the model is MODEL_HEIGHT tall (BODY_SCALE then sizes it in the world). */
export const FBX_TO_WORLD_SCALE = 0.01;

/**
 * THE BODY SCALE: how big every character is against the world. The town, its
 * cars and its furniture were sized for a slimmer person than the chunky Bloxity
 * avatar, so the avatar (players, companions, NPCs, their collision, poses and the
 * camera that frames them) is drawn at 0.8 of its model size: everything else
 * reads 25% bigger around it, and a seated avatar fits under a car roof.
 * Multiply it into any body-relative length (see bodyScale in config/ages.ts).
 */
export const BODY_SCALE = 0.8;

/** The avatar model's own height before BODY_SCALE (player.fbx at 320 * FBX_TO_WORLD_SCALE). */
export const MODEL_HEIGHT = 3.2;

/** The player's collision height, world units. */
export const PLAYER_HEIGHT = MODEL_HEIGHT * BODY_SCALE;

/** Horizontal half-width of the player's collision body. */
export const PLAYER_RADIUS = 0.7;

/**
 * How large the head is drawn, Roblox-style. Applied to the neck bone by
 * `PlayerRig`, multiplied with the portal's own head proportion.
 */
export const HEAD_SCALE = 1.12;

export const neckScale = (portalHeadScale = 1): number => {
  const chosen = Number.isFinite(portalHeadScale) && portalHeadScale > 0 ? portalHeadScale : 1;
  return HEAD_SCALE * chosen;
};
