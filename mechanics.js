/* 
  Refactored mechanics aggregator:
  - Split detailed implementations into small modules: checkpoints.js, jumpPads.js, movingPlatforms.js
  - This file acts as a thin orchestrator that wires those modules into the LevelManager.
  - Tombstones for previously removed/large functions are preserved below.
*/

import { initCheckpoints, checkpointUpdate } from './checkpoints.js';
import { initJumpPads, jumpPadsUpdate } from './jumpPads.js';
import { initMovingPlatforms, movingPlatformsUpdate } from './movingPlatforms.js';

/**
 * registerMechanics(manager)
 * Attaches lightweight update hook to the manager and exposes helper creators.
 */
export function registerMechanics(manager) {
    // Ensure containers exist
    manager.checkpoints = manager.checkpoints || [];
    manager.jumppads = manager.jumppads || [];
    manager.movingPlatforms = manager.movingPlatforms || [];

    // Initialize helper functions which will attach createX methods onto manager
    initCheckpoints(manager);
    initJumpPads(manager);
    initMovingPlatforms(manager);

    // Combined update delegate called from LevelManager.update
    manager._mechanics = {
        update: (dt, ballBody) => {
            // Delegate to each module's update logic
            movingPlatformsUpdate(manager, dt);
            checkpointUpdate(manager, dt, ballBody);
            jumpPadsUpdate(manager, dt, ballBody);
        }
    };

    // Re-append the level extensions (kept here for modularity; could be moved later)
    manager._levels = manager._levels || [];
    // (Levels 9-15 were appended here previously; they are left intact in levelDefs.js additions)
}

/* Tombstones: large/removed implementations moved to dedicated modules for clarity
   // removed large update() body handling movingPlatforms/checkpoints/jumppads {}
   // removed manager.createCheckpoint() {}
   // removed manager.createJumpPad() {}
   // removed manager.createMovingPlatform() {}
*/

