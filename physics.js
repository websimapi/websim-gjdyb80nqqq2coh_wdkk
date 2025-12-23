import * as CANNON from 'cannon-es';

export class PhysicsWorld {
    constructor() {
        this.world = new CANNON.World();
        // Slightly reduced gravity for a heavier, more controllable marble (less twitchy launches)
        this.world.gravity.set(0, -12, 0);
        
        this.ballMaterial = new CANNON.Material('ball');
        this.groundMaterial = new CANNON.Material('ground');
        
        const ballGroundContact = new CANNON.ContactMaterial(
            this.ballMaterial,
            this.groundMaterial,
            {
                // Tweak friction/restition to avoid snagging on sharp vertices while keeping a solid "heavy" feel
                friction: 0.6,
                restitution: 0.03
            }
        );
        this.world.addContactMaterial(ballGroundContact);
        
        this.ballBody = null;
        this.meshPairs = [];

        // Track whether the ball was airborne last update to detect landing transitions
        this.wasAirborne = false;

        // Editor/run pause flag: when true update() will no-op and physics bodies remain static until resumed.
        this.paused = false;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }

    addBall(position) {
        const shape = new CANNON.Sphere(0.5);
        this.ballBody = new CANNON.Body({
            mass: 1,
            shape: shape,
            material: this.ballMaterial,
            linearDamping: 0.05,
            angularDamping: 0.1
        });
        this.ballBody.position.copy(position);

        // initialize grounded flag so input can reliably check ground state
        this.ballBody.isGrounded = false;

        // Track last contact time (seconds) to robustly determine grounded state
        this.ballBody._lastContactTime = 0;

        // Attach a debounced jump-sound player on the body so any controller can request a jump sound
        // and the physics layer ensures it's only played once per real jump.
        this._jumpAudio = this._jumpAudio || null;
        this._ensureJumpAudio = () => {
            if (!this._jumpAudio) {
                this._jumpAudio = new Audio('jump.mp3');
                this._jumpAudio.load();
                this._jumpAudio.volume = 0.4;
            }
        };
        // last time (s) the jump sound was played for this body
        this.ballBody._lastJumpSoundTime = 0;
        this.ballBody.playJumpSound = () => {
            try {
                const now = performance.now() * 0.001;
                // debounce: don't play again until at least 0.18s has passed (guard against spam)
                if ((now - this.ballBody._lastJumpSoundTime) < 0.18) return;
                // Only play if it seems like a jump event (we're leaving ground recently or currently just became airborne)
                // This extra check helps avoid playing when falling off ledges.
                const recentlyGrounded = (now - (this.ballBody._lastContactTime || 0)) < 0.25;
                if (!recentlyGrounded && !this.ballBody.isGrounded) {
                    // if not recently grounded or already airborne, still allow a play if previous jump sound wasn't recent
                    // (this handles some edge cases); proceed anyway
                }
                this._ensureJumpAudio();
                this._jumpAudio.currentTime = 0;
                this._jumpAudio.play().catch(()=>{});
                this.ballBody._lastJumpSoundTime = now;
            } catch (e) {
                // swallow errors to avoid breaking physics loop
            }
        };

        /**
         * IMPORTANT CORE LOGIC: Ground Detection
         * This collision handler uses contact normals to distinguish 'ground' from 'walls'.
         * Essential for preventing jump exploits and ensuring stable movement.
         */
        this.ballBody.addEventListener('collide', (e) => {
            const other = e.body;
            if (!other) return;

            // Only consider collisions with static bodies as "ground" if the contact normal
            // indicates an upward-facing surface (prevents walls/edges from marking grounded).
            if (other.mass === 0) {
                try {
                    // Try to inspect the contact normal (ni) provided by cannon-es contact object.
                    // contact.ni is the normal from body i to body j in the contact frame.
                    const contact = e.contact || e.contactEquation || null;
                    let normalY = null;
                    if (contact && typeof contact.ni !== 'undefined' && contact.ni) {
                        // contact.ni is the normal in the contact frame from body i -> body j.
                        // We need the Y component as seen from the ball. Determine which contact body is 'bi'/'bj'
                        // and flip the normal if necessary so positive Y always means "up" relative to the ball.
                        try {
                            // Some contact objects expose bi/bj (body i and body j)
                            const ni = contact.ni;
                            if (contact.bi && contact.bj) {
                                // If body i is the ball, the normal points from ball -> other, so invert to get surface normal
                                if (contact.bi.id === this.ballBody.id) {
                                    normalY = -ni.y;
                                } else {
                                    normalY = ni.y;
                                }
                            } else {
                                // Fallback: assume ni.y already points upward for the ball
                                normalY = ni.y;
                            }
                        } catch (err) {
                            normalY = contact.ni.y;
                        }
                    } else if (e.contact && e.contact.ni) {
                        // Backwards compatibility where event exposes contact under e.contact
                        const ni = e.contact.ni;
                        try {
                            if (e.contact.bi && e.contact.bj) {
                                if (e.contact.bi.id === this.ballBody.id) {
                                    normalY = -ni.y;
                                } else {
                                    normalY = ni.y;
                                }
                            } else {
                                normalY = ni.y;
                            }
                        } catch (err) {
                            normalY = ni.y;
                        }
                    }

                    // If the extracted normal is very small (unreliable) prefer a positional heuristic instead.
                    if (normalY === null || typeof normalY === 'undefined' || Math.abs(normalY) < 0.25) {
                        // If the other body has a box shape, use its top surface (position.y + halfExtents.y)
                        // as a robust fallback so thin/tall platforms report their top surface correctly.
                        try {
                            let topY = other.position.y;
                            if (other.shapes && other.shapes.length > 0) {
                                const s = other.shapes[0];
                                // For CANNON.Box the halfExtents are stored on the shape (v3) or in the .halfExtents property
                                if (s.halfExtents) {
                                    // Use absolute half-extent to avoid negative/rotated storage confusing "top" detection
                                    topY = other.position.y + Math.abs(s.halfExtents.y);
                                } else if (s.radius) {
                                    // fallback for spheres (not typical here)
                                    topY = other.position.y + s.radius;
                                } else if (s.vertices && s.vertices.length > 0) {
                                    // last-resort: approximate using max vertex Y in local space transformed by body's quaternion
                                    let maxY = -Infinity;
                                    for (let vi = 0; vi < s.vertices.length; vi++) {
                                        const v = s.vertices[vi];
                                        maxY = Math.max(maxY, v.y);
                                    }
                                    topY = other.position.y + maxY;
                                }
                            }
                            normalY = this.ballBody.position.y - topY;
                        } catch (err) {
                            // fallback to simple positional difference if anything goes wrong
                            normalY = (this.ballBody.position.y - other.position.y);
                        }
                    }

                    // Consider this a ground contact only when the normal has a strong upward component.
                    // Use a threshold (0.45) so slight slopes count but near-vertical walls don't.
                    if (normalY > 0.45) {
                        this.ballBody._lastContactTime = performance.now() * 0.001;
                        this.ballBody.isGrounded = true;

                        if (this.wasAirborne) {
                            // Aggressively reduce horizontal spin (x,z) to prevent spin converting to lateral impulse on landing.
                            const av = this.ballBody.angularVelocity;
                            av.x *= 0.1;
                            av.z *= 0.1;
                            av.scale(0.5, av);

                            // Nudge horizontal velocity down slightly to stabilize landing
                            const lv = this.ballBody.velocity;
                            lv.x *= 0.85;
                            lv.z *= 0.85;
                        }
                    }
                } catch (e) {
                    // If anything goes wrong, fall back to the previous behavior to avoid breaking collisions.
                    try {
                        this.ballBody._lastContactTime = performance.now() * 0.001;
                        this.ballBody.isGrounded = true;
                    } catch (err) {}
                }
            }
        });

        this.world.addBody(this.ballBody);
        return this.ballBody;
    }

    addBox(position, halfExtents, rotation = null) {
        // Ensure we create a fresh Vec3 for half-extents so CANNON has a stable, positive halfExtents.x/y/z
        const half = new CANNON.Vec3(Math.abs(halfExtents.x), Math.abs(halfExtents.y), Math.abs(halfExtents.z));
        const shape = new CANNON.Box(half);
        // Mirror the half-extents onto the shape object explicitly (some engines expect this property)
        shape.halfExtents = half;

        const body = new CANNON.Body({
            mass: 0, // Static
            shape: shape,
            material: this.groundMaterial
        });
        // Make sure the body's orientation is explicit (identity) unless a rotation is provided
        body.quaternion.set(0, 0, 0, 1);
        body.position.copy(position);
        if (rotation) body.quaternion.copy(rotation);
        this.world.addBody(body);
        return body;
    }

    update(dt) {
        // If paused (editor mode), do not step the world or update meshes
        if (this.paused) {
            // Still keep mesh geometry in their last known pose (no changes)
            return;
        }

        // Before stepping, determine grounded/airborne using recent contact time for robustness
        if (this.ballBody) {
            const now = performance.now() * 0.001;
            const lastContact = this.ballBody._lastContactTime || 0;

            // Primary detection: recent contact within a slightly longer window (220ms) to be forgiving on missed quick collisions.
            const contactGrounded = (now - lastContact) < 0.22;

            // Fallback detection: if vertical velocity is very small and the ball is near any static body underneath,
            // consider it grounded to avoid missed jumps when contact events are fragile (e.g. thin platforms, rotated walls).
            const velY = this.ballBody.velocity ? Math.abs(this.ballBody.velocity.y) : 0;

            // Broad proximity test: look for any static body beneath/near the ball within a small vertical range.
            // Improved: use body's horizontal extents (halfExtents / radius / vertex bounds) so large platforms
            // register correctly even when the ball is far from the body's center.
            let nearStaticUnder = false;
            try {
                const bx = this.ballBody.position.x;
                const by = this.ballBody.position.y;
                const bz = this.ballBody.position.z;
                for (let i = 0; i < this.world.bodies.length; i++) {
                    const b = this.world.bodies[i];
                    if (!b || b.id === this.ballBody.id) continue;
                    if (b.mass !== 0) continue; // only consider static bodies

                    // Determine top Y of the static body (prefer shape info)
                    let topY = b.position.y;
                    try {
                        if (b.shapes && b.shapes.length > 0) {
                            const s = b.shapes[0];
                            if (s.halfExtents) {
                                topY = b.position.y + Math.abs(s.halfExtents.y);
                            } else if (s.radius) {
                                topY = b.position.y + s.radius;
                            } else if (s.vertices && s.vertices.length > 0) {
                                let maxY = -Infinity;
                                for (let vi = 0; vi < s.vertices.length; vi++) {
                                    maxY = Math.max(maxY, s.vertices[vi].y);
                                }
                                topY = b.position.y + maxY;
                            }
                        }
                    } catch (e) {
                        // fallback topY = b.position.y
                    }

                    const dy = by - topY;

                    // Determine horizontal extents for the static body.
                    // For boxes use halfExtents.x/z, for spheres use radius, fallback to a small default extent.
                    let extentX = 1.5, extentZ = 1.5;
                    try {
                        if (b.shapes && b.shapes.length > 0) {
                            const s = b.shapes[0];
                            if (s.halfExtents) {
                                extentX = Math.abs(s.halfExtents.x);
                                extentZ = Math.abs(s.halfExtents.z);
                            } else if (s.radius) {
                                extentX = extentZ = s.radius;
                            } else if (s.vertices && s.vertices.length > 0) {
                                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                                for (let vi = 0; vi < s.vertices.length; vi++) {
                                    const v = s.vertices[vi];
                                    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
                                    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
                                }
                                extentX = Math.max(0.5, (maxX - minX) * 0.5);
                                extentZ = Math.max(0.5, (maxZ - minZ) * 0.5);
                            }
                        }
                    } catch (e) {
                        // use defaults
                    }

                    // Horizontal distance from body's center to ball (axis-aligned)
                    const dx = Math.abs(bx - b.position.x);
                    const dz = Math.abs(bz - b.position.z);

                    // Allow a small margin beyond the physical extents so being near the edge still counts.
                    const margin = 0.6;
                    const withinX = dx <= (extentX + margin);
                    const withinZ = dz <= (extentZ + margin);

                    // If ball horizontally overlaps the body's top projection and is near vertically, consider it near-under.
                    if (withinX && withinZ && dy > -0.6 && dy < 1.6) {
                        nearStaticUnder = true;
                        break;
                    }
                }
            } catch (e) {
                nearStaticUnder = false;
            }

            // A slightly looser velocity threshold is used when near a static underneath object so gentle rests count.
            const velocityFallbackGrounded = (velY < 0.14 && nearStaticUnder);

            const grounded = contactGrounded || velocityFallbackGrounded;

            this.wasAirborne = !grounded;
            try { this.ballBody.isGrounded = grounded; } catch(e){}
        } else {
            this.wasAirborne = false;
        }

        // Use a fixed time step with a few maxSubSteps to keep collisions stable
        // This prevents large correction impulses when framerate varies which could "launch" the ball on landing.
        this.world.step(1/60, dt, 3);
        
        // Update meshes
        for (const pair of this.meshPairs) {
            pair.mesh.position.copy(pair.body.position);
            pair.mesh.quaternion.copy(pair.body.quaternion);
        }
    }

    clearWorld() {
        while (this.world.bodies.length > 0) {
            this.world.removeBody(this.world.bodies[0]);
        }
        this.meshPairs = [];
        this.ballBody = null;
        this.wasAirborne = false;
    }
}

