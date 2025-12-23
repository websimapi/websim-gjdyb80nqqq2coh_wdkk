import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class InputHandler {
    constructor(camera, domElement, ballMesh, isMobile = false, scene = null) {
        this.camera = camera;
        this.domElement = domElement;
        this.ballMesh = ballMesh;
        this.isMobile = !!isMobile;
        this.scene = scene; // scene reference used for camera collision raycasts
        
        // Orbit Camera State (player)
        this.target = new THREE.Vector3();
        // Use explicit pitch in degrees for intuitive control: -90 (down) .. 90 (up).
        // Internally we map pitch -> phi when computing camera position so 0° = horizontal forward.
        this.pitchDeg = 25; // player camera pitch start slightly above horizontal
        this.theta = 0; // player horizontal angle (radians)
        this.radius = 8;
        this.radiusDesired = this.radius; // player desired camera distance
        this.minRadius = 0.05;
        this.maxRadius = 20;

        // Separate editor camera state (to fully sever editor <-> player camera coupling)
        this.editorPitchDeg = this.pitchDeg;
        this.editorTheta = this.theta;
        this.editorRadius = this.radiusDesired;

        // Keyboard state (for desktop WASD)
        this.keys = { forward: false, back: false, left: false, right: false };

        // Joystick State
        this.joystickVisible = false;
        this.joystickStartPos = new THREE.Vector2();
        this.joystickCurrentPos = new THREE.Vector2();
        this.joystickVector = new THREE.Vector2();
        this.joystickTouchId = null;
        
        this.cameraTouchId = null;
        this.lastCameraTouchPos = new THREE.Vector2();
        this.pinchDist = 0;

        this.joystickUI = document.getElementById('joystick-container');
        this.knobUI = document.getElementById('joystick-knob');
        this.jumpButtonUI = document.getElementById('jump-button');

        // Movement tuning: even gentler acceleration while keeping a top speed cap
        this.maxForce = 40;                // lowered peak force for a much gentler start
        this.maxVelocity = 12;             // slightly higher top speed
        this.maxAccelPerSecond = 18.0;     // further reduced per-second acceleration limit (m/s^2)

        // Jump tuning: lower jitter, allow coyote-time and jump-buffer so jumps feel responsive
        this.jumpForce = 11;               // base vertical impulse
        this.coyoteTime = 0.12;            // seconds after leaving ground where jump still works
        this.jumpBufferTime = 0.12;        // seconds before landing where a jump press is buffered
        this.lastGroundedTime = -9999;     // timestamp (s) of last known grounded moment
        this.lastJumpRequestTime = -9999;  // timestamp (s) of last jump request

        // Ground dampening: how quickly the marble comes to rest when not inputting
        this.dampenTime = 0.6;             // seconds to stop
        this.isMoving = false;

        // jump sound removed from input handler; physics layer will play jump audio reliably once-per-jump

        this.enabled = true;
        this._rightMouseDown = false;

        // Camera smoothing: higher => snappier, lower => smoother. Used to lerp camera position when collisions clamp it.
        this.camLerpSpeed = 50;
        this.mode = 'player'; // 'player' or 'editor'

        this.setupEvents();
    }

    setupEvents() {
        // remove any existing listeners first to avoid duplicates when re-binding
        this.removeEvents();

        // store bound handlers so they can be removed later
        this._boundTouchStart = (e) => this.handleTouchStart(e);
        this._boundTouchMove = (e) => this.handleTouchMove(e);
        this._boundTouchEnd = (e) => this.handleTouchEnd(e);

        this._boundRegisterJump = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            this.requestJump = true;
        };

        // Desktop-specific handlers (keyboard + mouse)
        this._boundWindowKeyDown = (e) => {
            if (!this.enabled) return;
            if (e.code === 'Space') { this.requestJump = true; }
            if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') this.keys.forward = true;
            if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') this.keys.back = true;
            if (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') this.keys.left = true;
            if (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') this.keys.right = true;
        };
        this._boundWindowKeyUp = (e) => {
            if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') this.keys.forward = false;
            if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') this.keys.back = false;
            if (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') this.keys.left = false;
            if (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') this.keys.right = false;
        };

        // Mouse handling: left click behaves normally; right click (button === 2) held rotates camera
        this._boundWindowMouseDown = (e) => {
            if (!this.enabled) return;
            // prevent context menu to allow right-drag rotate
            if (e.button === 2) {
                e.preventDefault();
                this._rightMouseDown = true;
                // begin camera rotation mode using the current mouse pos; use camera id -2 for pointer handling
                this.onCameraStart(e.clientX, e.clientY, -2);
                return;
            }

            if (e.target && e.target.id === 'jump-button') {
                this.requestJump = true;
                return;
            }

            // For desktop left-click allow normal click behavior: if left side click, begin joystick mimic (optional),
            // otherwise start camera drag only if the user holds right-click. But we keep left click free.
            if (e.clientX < window.innerWidth / 2 && this.isMobile) {
                this.onJoystickStart(e.clientX, e.clientY, -1);
            } else if (this.isMobile === false) {
                // desktop: dragging with left mouse does not move camera by default (user wanted no pointerlock)
                // If user still wants camera rotate they can hold right mouse button.
            } else {
                // fallback
                this.onCameraStart(e.clientX, e.clientY, -1);
            }
        };

        this._boundWindowMouseMove = (e) => {
            if (!this.enabled) return;
            if (this.joystickVisible && this.joystickTouchId !== null) this.onJoystickMove(e.clientX, e.clientY);
            if (this.cameraTouchId !== null) this.onCameraMove(e.clientX, e.clientY);
        };

        this._boundWindowMouseUp = (e) => {
            if (!this.enabled) return;
            if (e.button === 2) {
                this._rightMouseDown = false;
                this.cameraTouchId = null;
                return;
            }
            // release joystick if it was started by mouse
            this.onJoystickEnd();
            this.cameraTouchId = null;
        };

        // attach touch listeners to the current domElement (may be renderer.domElement) for mobile/touch
        if (this.domElement) {
            // Touch events only meaningful on touch-capable devices
            this.domElement.addEventListener('touchstart', this._boundTouchStart, { passive: false });
            this.domElement.addEventListener('touchmove', this._boundTouchMove, { passive: false });
            this.domElement.addEventListener('touchend', this._boundTouchEnd, { passive: false });
            this.domElement.addEventListener('touchcancel', this._boundTouchEnd, { passive: false });

            // Wheel zoom: smooth, clamped, and respects min/max radii
            this._boundWheel = (ev) => {
                if (!this.enabled) return;
                // Always handle wheel zooming for the game canvas to ensure consistent zoom behavior.
                // Prevent the default page scroll when zooming so the view doesn't jump.
                try { ev.preventDefault(); } catch (e) {}
                // Normalize wheel delta across browsers (deltaY preferred)
                const delta = (typeof ev.deltaY === 'number') ? ev.deltaY : (ev.wheelDelta ? -ev.wheelDelta : 0);
                // Zoom sensitivity (smaller = finer control)
                const zoomSpeed = 0.008;
                // Update desired radius and clamp to allowed bounds
                this.radiusDesired = THREE.MathUtils.clamp(this.radiusDesired + delta * zoomSpeed, this.minRadius, this.maxRadius);
            };
            // Ensure the wheel listener is attached to the current domElement; fallback to window if absent.
            if (this.domElement) {
                this.domElement.addEventListener('wheel', this._boundWheel, { passive: false });
            } else {
                window.addEventListener('wheel', this._boundWheel, { passive: false });
            }
        }

        // Ensure jump requests are captured for touch, pointer and mouse so jumps work reliably on all devices.
        if (this.jumpButtonUI) {
            this.jumpButtonUI.addEventListener('touchstart', this._boundRegisterJump, { passive: false });
            this.jumpButtonUI.addEventListener('pointerdown', this._boundRegisterJump);
            this.jumpButtonUI.addEventListener('mousedown', this._boundRegisterJump);
        }

        // Window-level listeners
        window.addEventListener('keydown', this._boundWindowKeyDown);
        window.addEventListener('keyup', this._boundWindowKeyUp);
        window.addEventListener('mousedown', this._boundWindowMouseDown);
        window.addEventListener('mousemove', this._boundWindowMouseMove);
        window.addEventListener('mouseup', this._boundWindowMouseUp);
        // Prevent context menu so right-drag works smoothly on the renderer/canvas
        // Also capture reference so it can be removed when rebinding events.
        this._boundWindowContextMenu = (ev) => {
            // Only prevent the default context menu when it originated from the current domElement (canvas)
            // or when the right-mouse drag flag is active.
            try {
                const targetIsCanvas = (ev.target === this.domElement);
                if (this._rightMouseDown || targetIsCanvas) ev.preventDefault();
            } catch (e) {}
        };
        window.addEventListener('contextmenu', this._boundWindowContextMenu);

        // Also prevent context menu directly on the canvas to avoid browser "save image..." menu.
        if (this.domElement) {
            this._boundDomContextMenu = (ev) => { ev.preventDefault(); };
            this.domElement.addEventListener('contextmenu', this._boundDomContextMenu);
        }

        // Keep a reference so removeEvents knows which element to unbind from later
        this._domElementBound = this.domElement;
    }

    removeEvents() {
        // Remove previously bound listeners if present
        try {
            if (this._domElementBound && this._boundTouchStart) {
                this._domElementBound.removeEventListener('touchstart', this._boundTouchStart);
                this._domElementBound.removeEventListener('touchmove', this._boundTouchMove);
                this._domElementBound.removeEventListener('touchend', this._boundTouchEnd);
                this._domElementBound.removeEventListener('touchcancel', this._boundTouchEnd);
            }
            // remove wheel listener if we previously bound one
            if (this._domElementBound && this._boundWheel) {
                this._domElementBound.removeEventListener('wheel', this._boundWheel);
                this._boundWheel = null;
            }
        } catch (e) {}

        try {
            if (this.jumpButtonUI && this._boundRegisterJump) {
                this.jumpButtonUI.removeEventListener('touchstart', this._boundRegisterJump);
                this.jumpButtonUI.removeEventListener('pointerdown', this._boundRegisterJump);
                this.jumpButtonUI.removeEventListener('mousedown', this._boundRegisterJump);
            }
        } catch (e) {}

        try {
            if (this._boundWindowMouseDown) window.removeEventListener('mousedown', this._boundWindowMouseDown);
            if (this._boundWindowMouseMove) window.removeEventListener('mousemove', this._boundWindowMouseMove);
            if (this._boundWindowMouseUp) window.removeEventListener('mouseup', this._boundWindowMouseUp);
            if (this._boundWindowKeyDown) window.removeEventListener('keydown', this._boundWindowKeyDown);
            if (this._boundWindowKeyUp) window.removeEventListener('keyup', this._boundWindowKeyUp);
        } catch (e) {}

        // Remove any contextmenu listeners we bound earlier
        try {
            if (this._boundWindowContextMenu) window.removeEventListener('contextmenu', this._boundWindowContextMenu);
            this._boundWindowContextMenu = null;
        } catch (e) {}

        try {
            if (this._boundDomContextMenu && this._domElementBound) {
                this._domElementBound.removeEventListener('contextmenu', this._boundDomContextMenu);
            }
            this._boundDomContextMenu = null;
        } catch (e) {}

        // clear stored references so subsequent setup creates fresh bindings
        this._domElementBound = null;
        this._boundTouchStart = null;
        this._boundTouchMove = null;
        this._boundTouchEnd = null;
        this._boundRegisterJump = null;
        this._boundWindowMouseDown = null;
        this._boundWindowKeyDown = null;
        this._boundWindowKeyUp = null;
        this._boundWindowMouseMove = null;
        this._boundWindowMouseUp = null;
    }

    handleTouchStart(e) {
        if (!this.enabled) return;
        // Do not preventDefault here to allow editor selection and UI buttons to work. 
        // pointer-events: none on the canvas isn't an option because we need to drag.
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            // If touch is in bottom-left quarter, start joystick
            if (touch.clientX < window.innerWidth / 2 && touch.clientY > window.innerHeight / 2 && !this.joystickVisible) {
                this.onJoystickStart(touch.clientX, touch.clientY, touch.identifier);
            } else if (this.cameraTouchId === null) {
                this.onCameraStart(touch.clientX, touch.clientY, touch.identifier);
            }
        }

        // Only start a pinch if there are exactly 2 active touches and neither is the joystick touch.
        if (e.touches.length === 2) {
            const idA = e.touches[0].identifier;
            const idB = e.touches[1].identifier;
            if (idA !== this.joystickTouchId && idB !== this.joystickTouchId) {
                this.pinchDist = this.getTouchDist(e.touches[0], e.touches[1]);
                // If cameraTouchId hasn't been set yet, assign one of the two touches to camera control
                if (this.cameraTouchId === null) {
                    this.cameraTouchId = idA;
                    this.lastCameraTouchPos.set(e.touches[0].clientX, e.touches[0].clientY);
                }
            }
        }
    }

    handleTouchMove(e) {
        if (!this.enabled) return;
        // Only prevent default if we are actively dragging a camera or joystick to avoid blocking scroll or other UI
        if (this.joystickVisible || this.cameraTouchId !== null) {
            e.preventDefault();
        }
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === this.joystickTouchId) {
                this.onJoystickMove(touch.clientX, touch.clientY);
            } else if (touch.identifier === this.cameraTouchId) {
                // If there are two touches, ensure the other touch isn't the joystick before treating it as a pinch
                if (e.touches.length === 2) {
                    const idA = e.touches[0].identifier;
                    const idB = e.touches[1].identifier;
                    if (idA !== this.joystickTouchId && idB !== this.joystickTouchId) {
                        const d = this.getTouchDist(e.touches[0], e.touches[1]);
                        const delta = d - this.pinchDist;
                        // Update radiusDesired (the unified zoom target) instead of writing directly to radius so zooming
                        // remains authoritative and isn't overwritten by the main update loop.
                        this.radiusDesired = THREE.MathUtils.clamp((this.radiusDesired !== undefined ? this.radiusDesired : this.radius) - delta * 0.05, this.minRadius, this.maxRadius);
                        this.pinchDist = d;
                    } else {
                        // If the second touch is actually the joystick, ignore pinch and treat as camera drag using the camera touch
                        this.onCameraMove(touch.clientX, touch.clientY);
                    }
                } else {
                    this.onCameraMove(touch.clientX, touch.clientY);
                }
            }
        }
    }

    handleTouchEnd(e) {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === this.joystickTouchId) {
                this.onJoystickEnd();
            } else if (touch.identifier === this.cameraTouchId) {
                this.cameraTouchId = null;
            }
        }
    }

    getTouchDist(t1, t2) {
        return Math.sqrt(Math.pow(t2.clientX - t1.clientX, 2) + Math.pow(t2.clientY - t1.clientY, 2));
    }

    onJoystickStart(x, y, id) {
        this.joystickVisible = true;
        this.joystickTouchId = id;
        this.joystickStartPos.set(x, y);
        this.joystickCurrentPos.set(x, y);
        this.joystickUI.style.display = 'block';
        this.joystickUI.style.left = `${x}px`;
        this.joystickUI.style.top = `${y}px`;
        this.knobUI.style.transform = `translate(-50%, -50%)`;
    }

    onJoystickMove(x, y) {
        this.joystickCurrentPos.set(x, y);
        const dist = this.joystickStartPos.distanceTo(this.joystickCurrentPos);
        // Larger comfortable joystick radius so small finger movements don't max out instantly
        const maxDist = 90;
        const clampedDist = Math.min(dist, maxDist);
        
        const dir = new THREE.Vector2().subVectors(this.joystickCurrentPos, this.joystickStartPos).normalize();
        this.joystickVector.copy(dir).multiplyScalar(clampedDist / maxDist);
        
        const knobX = dir.x * clampedDist;
        const knobY = dir.y * clampedDist;
        this.knobUI.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
    }

    onJoystickEnd() {
        this.joystickVisible = false;
        this.joystickTouchId = null;
        this.joystickVector.set(0, 0);
        this.joystickUI.style.display = 'none';
    }

    onCameraStart(x, y, id) {
        this.cameraTouchId = id;
        this.lastCameraTouchPos.set(x, y);
    }

    onCameraMove(x, y) {
        // If an editor gizmo is being dragged, do not rotate the camera
        if (window._isGizmoDragging) {
            this.lastCameraTouchPos.set(x, y);
            return;
        }

        const dx = x - this.lastCameraTouchPos.x;
        const dy = y - this.lastCameraTouchPos.y;
        
        // Invert vertical rotation so dragging up looks up and dragging down looks down.
        // use independent state depending on mode so editor and player cameras are not coupled
        if (this.mode === 'editor') {
            this.editorTheta -= dx * 0.008;
            this.editorPitchDeg = THREE.MathUtils.clamp(this.editorPitchDeg - dy * 0.45, -90, 90);
        } else {
            // pitchDeg increases looking up (towards 90), decreases looking down (towards -90)
            this.theta -= dx * 0.008;
            // Inverted vertical control for play mode: dragging up now looks down and dragging down looks up.
            this.pitchDeg = THREE.MathUtils.clamp(this.pitchDeg + dy * 0.45, -90, 90);
        }
        
        this.lastCameraTouchPos.set(x, y);
    }

    updateEditorCamera(dt) {
        // Joystick moves camera position in full 3D (freecam) following the camera's forward/right directions
        if (this.joystickVector.length() > 0.05) {
            const moveSpeed = 18 * dt;
            // Use camera quaternion so movement follows view direction including vertical component
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();

            // Apply movement directly in world space (no flattening) for true freecam behavior
            this.camera.position.addScaledVector(right, this.joystickVector.x * moveSpeed);
            this.camera.position.addScaledVector(forward, -this.joystickVector.y * moveSpeed);
        }

        // Camera Vertical Controls (Held buttons)
        if (window._edCamUp) this.camera.position.y += 12 * dt;
        if (window._edCamDown) this.camera.position.y -= 12 * dt;

        // Mouse right-drag or touch drag rotates camera using editor-specific orientation
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(this.editorPitchDeg), this.editorTheta, 0, 'YXZ'));
        this.camera.quaternion.slerp(q, 0.3);

        // Radius in editor mode could act as a movement multiplier or offset; use editorRadius for editor-specific zoom
        if (this.pinchDist !== 0) {
            // pinch updates radiusDesired; consume editorRadius against radiusDesired so editor pinch/zoom
            // uses the same authoritative desired radius and doesn't get clobbered by the main update loop.
            const currentDesired = (this.radiusDesired !== undefined) ? this.radiusDesired : this.radius;
            const zoomAmount = (this.editorRadius - currentDesired) * 0.5;
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            this.camera.position.addScaledVector(forward, zoomAmount);
            // sync editorRadius to the consumed desired value
            this.editorRadius = currentDesired;
        }
    }

    setMode(mode) {
        // Switch camera/input mode. When entering editor, initialize editor state from current player camera
        if (mode === 'editor' && this.mode !== 'editor') {
            this.editorPitchDeg = this.pitchDeg;
            this.editorTheta = this.theta;
            this.editorRadius = this.radiusDesired;
        }
        // When switching back to player, do not overwrite player state with editor changes (severed)
        if (mode === 'player' && this.mode === 'editor') {
            // leave player pitch/theta/radius untouched so editor changes remain isolated
        }
        this.mode = mode;
    }

    update(dt, ballBody) {
        
        // --- 1. Universal Input Processing (WASD -> Joystick Vector) ---
        // Keyboard -> emulate joystick for desktop controls when no touch joystick active
        if (!this.isMobile && this.enabled) {
            const kbX = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
            const kbY = (this.keys.back ? 1 : 0) - (this.keys.forward ? 1 : 0);
            const v = new THREE.Vector2(kbX, kbY);
            if (v.lengthSq() > 0) {
                v.normalize();
                this.joystickVector.copy(v).multiplyScalar(1.0);
                this.joystickVisible = true; // logical visible for update purposes (not UI)
            } else {
                if (!this.joystickTouchId) this.joystickVector.set(0, 0);
                this.joystickVisible = false;
            }
        }
        
        // --- 2. Editor Camera Update (FPS Style) ---
        if (this.mode === 'editor') {
            this.updateEditorCamera(dt);
            // In FPS mode, we control the camera's rotation directly.
            return;
        }

        // --- 3. Player Mode Physics and Camera Logic Starts Here ---
        if (!ballBody || !this.enabled) return;

        // Air Damping (Slowdown in air)
        const isAirborne = Math.abs(ballBody.velocity.y) > 0.5;
        if (isAirborne) {
            // Apply stronger horizontal air drag to reduce unrealistic glide and help landings feel solid
            ballBody.velocity.x *= 0.97;
            ballBody.velocity.z *= 0.97;
            // also gently reduce angular velocity in air to avoid huge spin accumulation
            ballBody.angularVelocity.x *= 0.98;
            ballBody.angularVelocity.y *= 0.98;
            ballBody.angularVelocity.z *= 0.98;
        }
        
        // 0. Jump Logic with coyote-time and input buffering for smoother, more predictable jumps
        const now = performance.now() * 0.001; // seconds

        // Track last grounded time so coyote-time can be used
        if (ballBody.isGrounded) {
            this.lastGroundedTime = now;
        }

        // If a jump request came from UI/keyboard/touch, record its time (buffering)
        if (this.requestJump) {
            this.requestJump = false;
            this.lastJumpRequestTime = now;
        }

        // Determine whether a jump should fire: either currently grounded or within coyote-time window,
        // and the jump request occurred within the jump-buffer window.
        const withinCoyote = (now - this.lastGroundedTime) <= this.coyoteTime;
        const jumpBuffered = (now - this.lastJumpRequestTime) <= this.jumpBufferTime;

        if (jumpBuffered && (ballBody.isGrounded || withinCoyote)) {
            // consume buffered jump
            this.lastJumpRequestTime = -9999;
            // Give extra vertical boost proportional to horizontal speed so moving jumps go higher,
            // but never reduce an existing upward velocity (preserve natural arc).
            const horSpeed = Math.hypot(ballBody.velocity.x, ballBody.velocity.z);
            const extra = Math.min(horSpeed * 0.15, 6);
            const targetVy = this.jumpForce + extra;
            if (ballBody.velocity.y < targetVy) {
                ballBody.velocity.y = targetVy;
            } else {
                // still nudge slightly so presses while already rising feel responsive
                ballBody.velocity.y += 0.02;
            }

            // Clear grounded flag immediately to avoid double-triggering while in the same physics step
            try { ballBody.isGrounded = false; } catch(e){}

            // Request physics-associated jump-sound playback which enforces debounce and once-per-jump behavior.
            try {
                if (ballBody && typeof ballBody.playJumpSound === 'function') {
                    ballBody.playJumpSound();
                }
            } catch (e) {}
        }

        /**
         * IMPORTANT CORE LOGIC: Camera Raycasting
         * Prevents the camera from clipping through geometry. 
         * The margin and filtering logic here is sensitive; do not remove without thorough testing.
         */
        // 1. Camera Orbit Logic
        // Safely handle cases where ballMesh may be null (e.g. menu/demo state)
        const ballPos = (this.ballMesh && this.ballMesh.position) ? this.ballMesh.position : new THREE.Vector3();
        this.target.copy(ballPos);

        // Map intuitive pitchDeg (-90..90 where 0 = horizontal forward) to Three's polar angle phi:
        // phi = PI/2 - pitchRad. This lets pitchDeg=0 produce a horizontal camera, +90 look straight up, -90 straight down.
        const pitchRad = THREE.MathUtils.degToRad(this.pitchDeg);
        const phi = THREE.MathUtils.clamp(Math.PI / 2 - pitchRad, 0.0001, Math.PI - 0.0001);

        // Immediately follow desired radius (disable smoothing to avoid zoom reset bugs)
        this.radiusDesired = THREE.MathUtils.clamp(this.radiusDesired, this.minRadius, this.maxRadius);
        // directly apply desired radius (no lerp) so zoom changes are immediate and stable
        this.radius = this.radiusDesired;

        // Compute desired camera position from spherical coordinates (radius, phi, theta)
        const desiredPos = new THREE.Vector3();
        desiredPos.x = this.target.x + this.radius * Math.sin(phi) * Math.sin(this.theta);
        desiredPos.y = this.target.y + this.radius * Math.cos(phi);
        desiredPos.z = this.target.z + this.radius * Math.sin(phi) * Math.cos(this.theta);

        // Camera collision: raycast from target toward desired camera position and clamp if geometry sits between.
        if (this.scene && typeof THREE.Raycaster !== 'undefined') {
            try {
                const rayOrigin = this.target.clone();
                const toCam = new THREE.Vector3().subVectors(desiredPos, rayOrigin);
                const desiredDist = toCam.length();

                // If desired distance is extremely small (camera wants to sit almost on the target),
                // still compute a collision ray along the backward direction using minRadius so clamping remains meaningful.
                let rayDir = null;
                let maxCast = Math.max(desiredDist, this.minRadius + 0.001);
                if (desiredDist > 0.0001) {
                    rayDir = toCam.clone().normalize();
                } else {
                    // fallback direction: opposite of camera forward (use theta & pitchRad mapping)
                    const pitchRad = THREE.MathUtils.degToRad(this.pitchDeg);
                    const phi = THREE.MathUtils.clamp(Math.PI / 2 - pitchRad, 0.0001, Math.PI - 0.0001);
                    // spherical -> direction from target to camera when radius = 1
                    rayDir = new THREE.Vector3(
                        Math.sin(phi) * Math.sin(this.theta),
                        Math.cos(phi),
                        Math.sin(phi) * Math.cos(this.theta)
                    ).normalize();
                }

                // Cast from target toward the camera up to the larger of desiredDist or minRadius so collisions still clamp when zoomed in.
                const ray = new THREE.Raycaster(rayOrigin, rayDir, 0.05, maxCast + 0.1);

                // Intersect all objects in scene (deep), but ignore the player's ball mesh so it doesn't block view.
                const allObjs = this.scene.children;
                const intersects = ray.intersectObjects(allObjs, true).filter(it => {
                    // ignore collisions against the ball mesh (and its descendants)
                    if (!this.ballMesh) return true;
                    let o = it.object;
                    while (o) {
                        if (o === this.ballMesh) return false;
                        o = o.parent;
                    }
                    return true;
                });

                if (intersects && intersects.length > 0) {
                    const hit = intersects[0];
                    // position camera slightly in front of the hit point to avoid clipping (offset by margin)
                    const margin = 0.45;
                    const hitDist = hit.distance;
                    // clamp the new distance so it never goes below minRadius, preserving a usable orbit distance
                    const newDist = THREE.MathUtils.clamp(hitDist - margin, this.minRadius, this.maxRadius);
                    const targetPos = rayOrigin.clone().add(rayDir.clone().multiplyScalar(Math.max(0.001, newDist)));

                    // Immediately position camera (no lerp) to avoid smoothing-related zoom resets
                    this.camera.position.copy(targetPos);
                } else {
                    // no obstruction: move camera directly to desired position (no lerp)
                    this.camera.position.copy(desiredPos);
                }
            } catch (e) {
                // fallback if raycast fails
                this.camera.position.copy(desiredPos);
            }
        } else {
            // no scene available: place camera at desired position
            this.camera.position.copy(desiredPos);
        }

        this.camera.lookAt(this.target);

        // 2. Physics Force Logic
        // Slightly higher deadzone so tiny accidental nudges are ignored
        if (this.joystickVector && this.joystickVector.length() > 0.15) {
            this.isMoving = true;
            // Get camera orientation for relative movement
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.theta));
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.theta));
            
            // Re-normalize to flat plane
            forward.y = 0; forward.normalize();
            right.y = 0; right.normalize();

            // Calculate desired direction from joystick
            const desiredDir = new THREE.Vector3();
            desiredDir.addScaledVector(right, this.joystickVector.x);
            desiredDir.addScaledVector(forward, -this.joystickVector.y);
            desiredDir.normalize();

            // AIR CONTROL: Slightly reduced air control so steering isn't overpowered in mid-air
            const isAirborne2 = Math.abs(ballBody.velocity.y) > 0.5;
            const airControlMultiplier = isAirborne2 ? 0.7 : 1.0;

            // Compute current horizontal velocity and its component along desired direction
            const currentVel = new THREE.Vector3(ballBody.velocity.x, 0, ballBody.velocity.z);
            const currentAlong = currentVel.dot(desiredDir); // m/s along desiredDir

            // Determine how much additional speed along desiredDir we can allow before hitting maxVelocity
            const remainingSpeedCap = Math.max(0, this.maxVelocity - currentAlong);

            // Desired acceleration (m/s^2) allowed this frame based on per-second accel limit
            const accelPerFrame = this.maxAccelPerSecond * dt * airControlMultiplier;

            // Also cap acceleration by peak force translated to accel (mass = 1) over this frame
            const accelCapFromForce = this.maxForce * dt;

            // Final allowed acceleration (m/s) to add this frame, never exceeding remaining speed cap
            const allowedAccel = Math.min(accelPerFrame, accelCapFromForce, remainingSpeedCap);

            // Convert allowed acceleration into an impulse for this physics step (impulse = deltaV * mass)
            const impulse = desiredDir.clone().multiplyScalar(allowedAccel);

            // Directly modify velocity instead of applying impulse at a world point.
            // This eliminates precision-based torque errors at high coordinates.
            if (impulse.lengthSq() > 0) {
                ballBody.velocity.x += impulse.x;
                ballBody.velocity.z += impulse.z;
            }
        } else {
            this.isMoving = false;
        }

        // 3. Max Velocity Clamp (Horizontal only to preserve gravity effects)
        const horVel = new THREE.Vector2(ballBody.velocity.x, ballBody.velocity.z);
        const horSpeed = horVel.length();
        if (horSpeed > this.maxVelocity) {
            const scale = this.maxVelocity / horSpeed;
            ballBody.velocity.x *= scale;
            ballBody.velocity.z *= scale;
        }

        // 4. Dampening (0.8s to stop on flat)
        // Only apply if not inputting and on ground (simplified check: low Y velocity)
        if (!this.isMoving && Math.abs(ballBody.velocity.y) < 0.1) {
            const dampingFactor = Math.pow(0.01, dt / this.dampenTime);
            // Apply damping directly to the body's horizontal velocity components
            ballBody.velocity.x *= dampingFactor;
            ballBody.velocity.z *= dampingFactor;
            // Also damp angular velocity for smoother settling
            ballBody.angularVelocity.scale(dampingFactor, ballBody.angularVelocity);
        }
    }
}

