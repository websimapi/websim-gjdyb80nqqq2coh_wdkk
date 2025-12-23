import * as THREE from 'three';
/*
  New module: levelDefs.js
  Contains level registration only. Each level calls LevelManager's small API (createPlatform, createBall, createWinArea)
  Extended to provide unique entries for levels 1..15 (indices 0..14).
*/
export function registerLevels(manager) {
    // store levels in the manager for loadLevel to call
    manager._levels = [
        // 1 (Very Easy Start)
        () => {
            // Large safe start area and a very short route to the goal for a gentle tutorial
            manager.createPlatform(0, 0, 0, 22, 1.6, 22, 0x88aacc); // huge safe pad
            manager.createBall(0, 2, 0);
            // A simple raised platform a short roll away
            manager.createPlatform(0, 0.6, 8, 8, 1, 6, 0x66cc88);
            // Slight step and finish right ahead
            manager.createPlatform(0, 1.6, 14, 6, 1, 6, 0xaacc66);
            manager.createWinArea(0, 1.6, 16);
        },
        // 2
        () => {
            manager.createPlatform(0, 0, 0, 10, 1, 10, 0xaa44aa); 
            manager.createBall(0, 2, 0);
            const colors = [0xffffff, 0xdddddd];
            for(let i=0; i<10; i++) {
                const x = (i % 2 === 0) ? 0 : 8;
                const z = 12 + i * 6;
                manager.createPlatform(x, 0, z, 6, 0.5, 6, colors[i % 2]);
            }
            manager.createPlatform(4, 0, 75, 12, 1, 12, 0xaa44aa);
            manager.createWinArea(4, 0, 78);
        },
        // 3
        () => {
            manager.createPlatform(0, 0, 0, 8, 1, 8, 0x333333);
            manager.createBall(0, 2, 0);
            let lastX = 0, lastY = 0, lastZ = 10;
            for(let i=0; i<8; i++) {
                const x = Math.sin(i * 1.2) * 4;
                const y = i * 1.4;
                const z = 10 + i * 5;
                manager.createPlatform(x, y, z, 4.5, 0.8, 4.5, 0xffcc33);
                lastX = x; lastY = y; lastZ = z;
            }
            manager.createPlatform(lastX * 0.5, lastY + 1.2, lastZ + 5, 5, 0.8, 5, 0xffcc33);
            manager.createPlatform(0, lastY + 2.4, lastZ + 10, 8, 1, 8, 0x33ccff);
            manager.createWinArea(0, lastY + 2.4, lastZ + 10);
        },
        // 4
        () => {
            manager.createPlatform(0, 0, 0, 10, 1, 10, 0x224422);
            manager.createBall(0, 2, 0);
            for(let i=0; i<12; i++) {
                if (i % 2 === 0) {
                    const side = (i % 4 === 0) ? -4 : 4;
                    manager.createPlatform(side, 0, 10 + i * 6, 12, 0.5, 3, 0x44aa44);
                }
                if(i % 3 === 0) {
                    manager.createPlatform(0, 1, 10 + i * 6, 3, 3, 1, 0xffffff);
                }
            }
            manager.createPlatform(0, 0, 90, 20, 1, 20, 0x224422);
            manager.createWinArea(0, 0, 95);
        },
        // 5
        () => {
            manager.createPlatform(0, 0, 0, 8, 1, 8, 0x556655);
            manager.createBall(0, 2, 0);
            const islandCount = 8;
            const forwardGap = 9;
            const lateralSpread = 3;
            for (let i = 0; i < islandCount; i++) {
                const rx = (Math.random() - 0.5) * lateralSpread * 2;
                const rz = 8 + i * forwardGap;
                const ry = (i === 0) ? 1.4 : Math.min(i * 0.45, 4);
                manager.createPlatform(rx, ry, rz, 2.8, 0.5, 2.8, 0xffcc88);
            }
            const finalY = Math.min(islandCount * 0.45 + 1.5, 8);
            manager.createPlatform(0, finalY, 8 + islandCount * forwardGap + 8, 12, 1, 12, 0x556655);
            manager.createWinArea(0, finalY, 8 + islandCount * forwardGap + 8);
        },
        // 6
        () => {
            manager.createPlatform(0, 0, 0, 10, 1, 2, 0x663300);
            manager.createBall(0, 2, 0);
            manager.createPlatform(0, 0, 10, 1, 0.5, 20, 0xaa8866);
            manager.createPlatform(0, 0, 25, 10, 1, 10, 0x663300);
            manager.createPlatform(5, 0, 40, 1, 0.5, 20, 0xaa8866);
            manager.createPlatform(5, 0, 55, 10, 1, 10, 0x663300);
            manager.createWinArea(5, 0, 55);
        },
        // 7
        () => {
            manager.createPlatform(0, 0, 0, 4, 1, 4, 0x003366);
            manager.createBall(0, 2, 0);
            for(let i=0; i<12; i++) {
                const angle = i * 0.5;
                const dist = 6;
                manager.createPlatform(
                    Math.cos(angle) * dist,
                    i * 1.2,
                    Math.sin(angle) * dist,
                    3, 0.5, 3, 0x3399ff
                );
            }
            manager.createPlatform(0, 15, 0, 8, 1, 8, 0x003366);
            manager.createWinArea(0, 15, 0);
        },
        // 8 - The Bridge (Reworked: Narrow zig-zag + timed shuttles & jump challenges)
        () => {
            // Start pad and ball
            manager.createPlatform(0, 0, 0, 10, 1.2, 10, 0x443344);
            manager.createBall(0, 2, 0);

            // Zig-zag sequence of narrow platforms that alternate left/right and vary height
            const steps = 18;
            for (let i = 0; i < steps; i++) {
                const side = (i % 2 === 0) ? -1.6 : 1.6;
                const x = side * (1 + (i % 4) * 0.25);
                const y = 0.2 + Math.floor(i / 6) * 0.6 + (i % 3) * 0.12;
                const z = 8 + i * 4.2;
                // very narrow, forcing precise roll and small hops
                manager.createPlatform(x, y, z, 1.2, 0.35, 3.6, 0xcc6644);

                // occasional small stepping stone requiring a jump across
                if (i % 5 === 3) {
                    manager.createPlatform(-x * 0.8, y + 0.6, z + 1.8, 1.6, 0.5, 1.8, 0xffcc88);
                }

                // Every 6th gap has a moving shuttle to cross a wider chasm
                if (i % 6 === 5) {
                    const gapZ = z + 3.0;
                    const ppath = [
                        new THREE.Vector3(x * 1.8, y, gapZ - 1.2),
                        new THREE.Vector3(-x * 1.8, y, gapZ + 1.2)
                    ];
                    manager.createMovingPlatform(0, y, gapZ, 2.0, 0.5, 3.0, 0x8899bb, ppath, 0.26 + (i % 3) * 0.04);
                }
            }

            // Mid-level small safe island with a jump-pad cluster to launch upward
            const midY = 0.2 + Math.floor(steps / 2 / 6) * 0.6 + 1.0;
            const midZ = 8 + Math.floor(steps / 2) * 4.2 + 6;
            manager.createPlatform(0, midY, midZ, 6, 1.2, 6, 0x334466);
            manager.createCheckpoint(0, midY + 1, midZ - 0.6);

            // Cluster of directional jump pads that require aiming to land on staggered catch platforms
            manager.createJumpPad(-1.8, midY + 0.4, midZ + 2, new THREE.Vector3(0.6, 0.9, 1).normalize(), 16);
            manager.createJumpPad(1.8, midY + 0.4, midZ + 2.8, new THREE.Vector3(-0.6, 0.9, 1).normalize(), 16);

            // Staggered catches after jump pads - small precise ledges with moving catches
            for (let s = 0; s < 5; s++) {
                const y = midY + 2 + s * 1.8;
                const z = midZ + 6 + s * 4.8;
                const x = (s % 2 === 0) ? -1.2 : 1.2;
                manager.createPlatform(x, y, z, 3.2 - s * 0.2, 0.6, 4.0 - s * 0.3, 0x66aa88);
                if (s === 2) {
                    const ppath = [
                        new THREE.Vector3(-2.2, y, z - 1.0),
                        new THREE.Vector3(2.2, y, z + 1.0)
                    ];
                    manager.createMovingPlatform(0, y, z, 2.0, 0.5, 3.0, 0xbb8866, ppath, 0.2);
                }
            }

            // Narrow final approach with a timed shuttle and tiny finish pad
            const finalY = midY + 2 + 5 * 1.8 + 1.2;
            const finalZ = midZ + 6 + 5 * 4.8 + 6;
            // timed shuttle across a last chasm
            const finalPath = [
                new THREE.Vector3(-3.0, finalY - 0.4, finalZ - 2),
                new THREE.Vector3(3.0, finalY - 0.4, finalZ + 2)
            ];
            manager.createMovingPlatform(0, finalY - 0.4, finalZ, 2.2, 0.6, 3.6, 0x334477, finalPath, 0.16);

            manager.createPlatform(0, finalY, finalZ + 4, 3.2, 0.8, 3.8, 0x223355);
            manager.createWinArea(0, finalY, finalZ + 6);
        },
        // 9 - Narrow Path (Reworked: rotating targets, collapsing-style timed platforms & tighter spacing)
        () => {
            // Starting area
            manager.createPlatform(0, 0, 0, 8, 1, 8, 0x334455);
            manager.createBall(0, 2, 0);

            // Sequence of narrow rotating/offset platforms: implement by placing small platforms in circular arcs
            const rings = 6;
            const stepsPerRing = 6;
            let baseZ = 8;
            for (let r = 0; r < rings; r++) {
                const radius = 3 + r * 0.6;
                const y = 0.2 + r * 0.6;
                for (let i = 0; i < stepsPerRing; i++) {
                    const angle = (i / stepsPerRing) * Math.PI * 2 + (r % 2 === 0 ? 0.2 : -0.2);
                    const x = Math.cos(angle) * radius;
                    const z = baseZ + r * 6 + Math.sin(angle) * 1.2;
                    manager.createPlatform(x, y, z, 1.4, 0.4, 2.6, 0xee7744);
                    // occasionally add a small jump pad to cross to the next arc
                    if ((i + r) % 4 === 2) {
                        manager.createJumpPad(x, y + 0.5, z + 0.8, new THREE.Vector3(Math.sign(-x) * 0.35, 0.9, 1).normalize(), 12);
                    }
                }
            }

            // Collapsing-style timed platforms: create narrow platforms in a row with one moving platform that must be used as a ferry.
            const fragZ = baseZ + rings * 6 + 4;
            for (let i = 0; i < 8; i++) {
                const x = (i % 2 === 0) ? -1.2 : 1.2;
                const y = 0.2 + rings * 0.6 + (i * 0.06);
                const z = fragZ + i * 3.2;
                manager.createPlatform(x, y, z, 1.0, 0.35, 2.6, 0x996644);
                if (i % 3 === 2) {
                    // moving platform crossing ahead as a narrow ferry
                    const path = [
                        new THREE.Vector3(-2.4, y, z + 1),
                        new THREE.Vector3(2.4, y, z + 1.8)
                    ];
                    manager.createMovingPlatform(0, y, z + 1.4, 1.8, 0.5, 3.0, 0x225577, path, 0.22 + (i % 2) * 0.06);
                }
            }

            // Final tight finish ledge with a precise small ring and win
            const finishY = 0.2 + rings * 0.6 + 8 * 0.06 + 2.2;
            const finishZ = fragZ + 8 * 3.2 + 4;
            // scatter a few tiny stepping stones that require accuracy to chain across
            for (let s = 0; s < 5; s++) {
                const x = (s % 2 === 0) ? -1.6 + s * 0.6 : 1.6 - s * 0.6;
                manager.createPlatform(x, finishY - 0.2 + s * 0.18, finishZ + s * 2.2, 1.4 - s * 0.12, 0.4, 2.0 - s * 0.12, 0x334455);
            }

            manager.createPlatform(0, finishY + 1.0, finishZ + 8, 3.0, 0.8, 3.0, 0x334455);
            manager.createWinArea(0, finishY + 1.0, finishZ + 10);
        },
        // 10 - Gauntlet Staircase (challenging): narrow staggered steps, timed moving platforms, jump pads & checkpoint
        () => {
            // Start pad and ball
            manager.createPlatform(0, 0, 0, 8, 1.2, 8, 0x223355);
            manager.createBall(0, 2.5, 0);

            // Very narrow staggered steps: require precise balance and small hops
            const steps = 40;
            const stepRise = 0.6;
            const stepDepth = 2.6;
            for (let i = 0; i < steps; i++) {
                const x = (i % 2 === 0) ? -0.9 : 0.9; // tight zig
                const y = 0.8 + i * stepRise;
                const z = 6 + i * stepDepth;
                // Extra narrow platform to punish rushing
                manager.createPlatform(x, y, z, 1.6, 0.45, 2.8, 0xff8844);

                // Add a gap every 5 steps with a small moving platform crossing it
                if (i % 5 === 4) {
                    const gapZ = z + 3.5;
                    // create two anchor platforms at both sides of the gap
                    manager.createPlatform(x * 1.4, y + 0.2, gapZ - 1.6, 1.8, 0.5, 1.8, 0x225577);
                    manager.createPlatform(-x * 1.4, y + 0.2, gapZ + 1.6, 1.8, 0.5, 1.8, 0x225577);
                    // moving platform that shuttles across the gap (player must time jumps)
                    const path = [
                        new THREE.Vector3(x * 1.4, y + 0.2, gapZ - 1.6),
                        new THREE.Vector3(-x * 1.4, y + 0.2, gapZ + 1.6)
                    ];
                    // speed tuned so platform takes ~2.2-3.2s to cross depending on segment distance
                    manager.createMovingPlatform(0, y + 0.2, gapZ, 2.0, 0.6, 2.8, 0x8899bb, path, 0.28 + (i % 3) * 0.06);
                }

                // Occasional tiny springy pad that helps reach small higher steps but can over-shoot
                if (i % 7 === 3) {
                    manager.createJumpPad(x, y + 0.6, z + 1.6, new THREE.Vector3(0, 0.9, 1).normalize(), 10);
                }
            }

            // Mid-level safe plateau with a checkpoint so you don't repeat the whole gauntlet
            const cpY = 0.8 + Math.floor(steps / 2) * stepRise + 1.2;
            const cpZ = 6 + Math.floor(steps / 2) * stepDepth + 4;
            manager.createPlatform(0, cpY, cpZ, 6, 1.2, 6, 0x334466);
            manager.createCheckpoint(0, cpY + 1, cpZ - 0.5);

            // After checkpoint: tighter timing and higher launch pads leading to a sloped ascent
            // Two powerful jump pads that catapult you to staggered high ledges
            const baseZ = cpZ + 8;
            manager.createJumpPad(-2.2, cpY + 0.5, baseZ, new THREE.Vector3(0.4, 0.85, 1).normalize(), 18);
            manager.createJumpPad(2.2, cpY + 0.5, baseZ + 6, new THREE.Vector3(-0.4, 0.85, 1).normalize(), 18);

            // High staggered platforms to catch the arcs, with small ramps to continue upward
            for (let s = 0; s < 5; s++) {
                const y = cpY + 6 + s * 2.6;
                const z = baseZ + 10 + s * 5;
                manager.createPlatform((s % 2 === 0) ? -1.6 : 1.6, y, z, 4 - s * 0.4, 0.7, 5.2, 0x66aa88);
                // place a subtle moving platform as a target on later stages
                if (s === 2) {
                    const ppath = [
                        new THREE.Vector3(-3.2, y, z - 1),
                        new THREE.Vector3(3.2, y, z + 1)
                    ];
                    manager.createMovingPlatform(0, y, z, 2.4, 0.6, 3.6, 0xbb8866, ppath, 0.18);
                }
            }

            // Final steep ramp into summit and a narrow finish platform
            const summitY = cpY + 6 + 5 * 2.6 + 1.8;
            const summitZ = baseZ + 10 + 5 * 5 + 6;
            // A sequence of sloped small platforms forming a ramp-like ascent
            for (let r = 0; r < 6; r++) {
                const y = cpY + 3 + r * 1.8;
                const z = baseZ + 6 + r * 4.5;
                manager.createPlatform(0.6 * r - 1.2, y, z, 6 - r * 0.6, 0.6, 6.8 - r * 0.6, 0x223355);
            }
            manager.createPlatform(0, summitY, summitZ, 8, 1.6, 8, 0x334477);
            manager.createWinArea(0, summitY, summitZ + 2);
        },
        // 11 - Floating Tiles
        () => {
            manager.createPlatform(0, 0, 0, 10, 1, 10, 0x556677);
            manager.createBall(0, 2, 0);
            for (let i = 0; i < 12; i++) {
                const x = (i % 3 - 1) * 3.5;
                const z = 8 + i * 5;
                const y = (i % 4) * 0.8;
                manager.createPlatform(x, y, z, 2.6, 0.5, 2.6, 0x88ccff);
            }
            manager.createPlatform(0, 2.4, 8 + 12 * 5 + 4, 10, 1, 10, 0x556677);
            manager.createWinArea(0, 2.4, 8 + 12 * 5 + 4);
        },
        // 12 - Narrow 'n Deep (long, narrow balance paths, deep drops, jump pads, slopes & ramps)
        () => {
            // Starting safe platform and ball
            manager.createPlatform(0, 0, 0, 10, 1, 8, 0x334455);
            manager.createBall(0, 2, 0);

            // Long sequence of narrow balance beams over deep drops
            const beamCount = 18;
            const beamSpacing = 8;
            for (let i = 0; i < beamCount; i++) {
                const z = 8 + i * beamSpacing;
                const x = (i % 3 === 0) ? 0 : (i % 3 === 1) ? -1.6 : 1.6;
                // very narrow beams that feel precarious
                manager.createPlatform(x, 0.1 + (i * 0.02), z, 1.2, 0.4, 6.0, 0x996644);
                // occasional tiny stepping stone offset to mix pacing
                if (i % 4 === 3) {
                    manager.createPlatform(x * 1.5, 0.6 + i * 0.02, z + 3.2, 2.0, 0.6, 2.8, 0xffcc88);
                }
            }

            // Deep lower pit under the beams (purely visual; course uses heights)
            // Add wider safe platforms that form ledges at varying heights for recovery
            manager.createPlatform(-6, -8, 8 + beamCount * beamSpacing * 0.25, 6, 1, 10, 0x223322);
            manager.createPlatform(6, -12, 8 + beamCount * beamSpacing * 0.6, 6, 1, 10, 0x223322);

            // High-strength jump pads positioned to catapult you to really high platforms
            // Use large power values to create big arcs (power ~ 28-34)
            manager.createJumpPad(0, 0.5, 8 + beamCount * beamSpacing + 6, new THREE.Vector3(0, 1, 1), 30);
            manager.createJumpPad(-3, 2.0, 8 + beamCount * beamSpacing + 14, new THREE.Vector3(0.2, 0.9, 1).normalize(), 34);
            manager.createJumpPad(3, 2.0, 8 + beamCount * beamSpacing + 22, new THREE.Vector3(-0.2, 0.9, 1).normalize(), 34);

            // Tall destination platforms that require jump-pad launches and provide slopes/ramps to continue
            manager.createPlatform(0, 18, 8 + beamCount * beamSpacing + 28, 8, 1.2, 8, 0x445588);
            // Sloped ramp-like sequences (staggered small platforms ascend to higher ledges)
            for (let s = 0; s < 6; s++) {
                const y = 18 + s * 2.4;
                const z = 8 + beamCount * beamSpacing + 32 + s * 6;
                manager.createPlatform(-2 + s * 0.8, y, z, 5 - s * 0.4, 0.8, 6, 0x66aa88);
            }

            // Final high ring and finish
            manager.createPlatform(0, 32, 8 + beamCount * beamSpacing + 32 + 6 * 6, 10, 1.6, 10, 0x334455);
            manager.createWinArea(0, 32, 8 + beamCount * beamSpacing + 32 + 6 * 6 + 3);
        },
        // 13 - Checker Steps
        () => {
            manager.createPlatform(0, 0, 0, 8, 1, 8, 0x553355);
            manager.createBall(0, 2, 0);
            for (let i = 0; i < 10; i++) {
                const x = (i % 2 === 0) ? -2.5 : 2.5;
                const z = 8 + i * 6;
                const y = Math.floor(i / 2) * 0.9;
                manager.createPlatform(x, y, z, 3, 0.6, 3, 0xff6666);
            }
            manager.createPlatform(0, 5, 8 + 10 * 6 + 6, 10, 1, 10, 0x553355);
            manager.createWinArea(0, 5, 8 + 10 * 6 + 6);
        },
        // 14 - Calm Plateau
        () => {
            manager.createPlatform(0, 0, 0, 12, 1, 12, 0x6688aa);
            manager.createBall(0, 2, 0);
            manager.createPlatform(0, 0, 18, 10, 1, 6, 0x88aa66);
            manager.createPlatform(0, 0, 36, 6, 1, 6, 0xaa6688);
            manager.createWinArea(0, 0, 38);
        },
        // 15 - Brutal Gauntlet (Hard Finale)
        () => {
            // small safe start pad
            manager.createPlatform(0, 0, 0, 8, 1.2, 8, 0x332244);
            manager.createBall(0, 2, 0);

            // Long narrow descending approach of thin beams with alternating offsets
            const lanes = 36;
            for (let i = 0; i < lanes; i++) {
                const z = 8 + i * 4.6;
                const x = (i % 3 === 0) ? 0 : (i % 3 === 1) ? -1.25 : 1.25;
                const y = Math.floor(i / 6) * 0.15; // subtle vertical variance
                // very narrow precarious beams
                manager.createPlatform(x, y, z, 1.0, 0.35, 4.2, 0x884422);
                // occasional tiny stepping stone offset
                if (i % 5 === 4) {
                    manager.createPlatform(x * 1.6, y + 0.6, z + 2.0, 1.8, 0.5, 2.2, 0xffcc66);
                }
            }

            // Mid gauntlet: moving platforms crossing wide gaps (timing required)
            let mpBaseZ = 8 + lanes * 4.6 + 6;
            for (let m = 0; m < 6; m++) {
                const y = 1.2 + m * 1.6;
                const z = mpBaseZ + m * 6;
                const span = 5 + m * 0.6;
                // anchors
                manager.createPlatform(-span, y, z - 2.4, 1.8, 0.5, 1.8, 0x225577);
                manager.createPlatform(span, y, z + 2.4, 1.8, 0.5, 1.8, 0x225577);
                // moving shuttle that the player must ride/jump to
                const path = [
                    new THREE.Vector3(-span, y, z - 2.4),
                    new THREE.Vector3(span, y, z + 2.4)
                ];
                manager.createMovingPlatform(0, y, z, 2.2, 0.6, 3.0, 0xbb8844, path, 0.18 + (m * 0.03));
            }

            // After moving platforms: a brutal vertical section with powerful jump pads and narrow catch platforms
            const jpStartZ = mpBaseZ + 6 * 6 + 6;
            manager.createJumpPad(-2.8, 2.6, jpStartZ, new THREE.Vector3(0.5, 0.95, 0.6).normalize(), 26);
            manager.createJumpPad(2.8, 2.6, jpStartZ + 4, new THREE.Vector3(-0.5, 0.95, 0.6).normalize(), 26);

            // Sequence of small high ledges to catch arcs; require precision
            for (let h = 0; h < 7; h++) {
                const y = 4 + h * 2.4;
                const z = jpStartZ + 8 + h * 5.2;
                const x = (h % 2 === 0) ? -1.6 : 1.6;
                manager.createPlatform(x, y, z, 3.2 - h * 0.18, 0.7, 4.4 - h * 0.28, 0x66aa88);
                if (h === 3) {
                    // small moving catch later to punish mis-timing
                    const ppath = [
                        new THREE.Vector3(-2.6, y, z - 1.2),
                        new THREE.Vector3(2.6, y, z + 1.2)
                    ];
                    manager.createMovingPlatform(0, y, z, 2.0, 0.5, 3.2, 0x996644, ppath, 0.2);
                }
            }

            // Final narrow summit run with tiny stepping stones and last checkpoint
            const summitY = 4 + 7 * 2.4;
            const summitZ = jpStartZ + 8 + 7 * 5.2 + 6;
            manager.createPlatform(-3, summitY - 0.6, summitZ - 4, 3, 0.7, 3.6, 0x334477);
            manager.createPlatform(3, summitY - 0.2, summitZ - 1.8, 3, 0.7, 3.6, 0x334477);
            manager.createPlatform(0, summitY, summitZ, 4.5, 1.2, 6, 0x223355);
            // checkpoint before the final tight finish
            manager.createCheckpoint(0, summitY + 1.2, summitZ - 0.8);

            // Final tight approach and tiny finish platform
            manager.createPlatform(0, summitY + 2.8, summitZ + 6, 2.4, 0.6, 3.2, 0x225566);
            manager.createWinArea(0, summitY + 2.8, summitZ + 8);
        }
    ];

    // extension point: mechanics or other modules can push more levels into manager._levels
}

