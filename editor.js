import * as THREE from 'three';

export class LevelEditor {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.activeTool = 'place';
        this.selectedPart = null;
        
        this.customParts = []; // { type, mesh, data }
        this.gizmoGroup = new THREE.Group();
        this.game.scene.add(this.gizmoGroup);
        // paint tool state
        this.currentColor = '#ffffff';
        this.isPainting = false;

        this.raycaster = new THREE.Raycaster();
        this.setupUI();
        
        // Gizmo materials
        this.gizmoMats = {
            x: new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.9 }),
            y: new THREE.MeshBasicMaterial({ color: 0x44ff44, depthTest: false, transparent: true, opacity: 0.9 }),
            z: new THREE.MeshBasicMaterial({ color: 0x4444ff, depthTest: false, transparent: true, opacity: 0.9 })
        };
    }

    setupUI() {
        this.ui = document.getElementById('editor-ui');
        this.toolButtons = document.querySelectorAll('.ed-tool-btn');
        this.partButtons = document.querySelectorAll('.ed-part-btn');
        this.paintGrid = document.getElementById('ed-paint-grid');
        this.deleteBtn = document.getElementById('ed-delete-btn');
        this.exitBtn = document.getElementById('ed-exit-btn');
        this.selectionInfo = document.getElementById('ed-selection-info');
        this.partNameDisplay = document.getElementById('ed-part-name');

        this.toolButtons.forEach(btn => {
            if (btn.dataset.tool) btn.onclick = () => this.setTool(btn.dataset.tool);
        });

        this.partButtons.forEach(btn => {
            btn.onclick = () => this.spawnPart(btn.dataset.type);
        });

        // hook Run button (added to toolbar)
        const runBtn = document.getElementById('ed-run-btn');
        if (runBtn) runBtn.onclick = () => this.run();

        this.deleteBtn.onclick = () => this.deleteSelected();
        this.exitBtn.onclick = () => {
            // Try to reuse existing create-level-btn behavior if present; otherwise fall back to game exit logic.
            const createBtn = document.getElementById('create-level-btn');
            if (createBtn && typeof createBtn.click === 'function') {
                try { createBtn.click(); return; } catch (e) { /* continue to fallback */ }
            }
            // Prefer calling the game's exitEditor if available, otherwise simply toggle editor off.
            try {
                if (this.game && typeof this.game.exitEditor === 'function') {
                    this.game.exitEditor();
                } else {
                    this.toggle(false);
                }
            } catch (e) {
                // As a final safe fallback, ensure editor UI is hidden
                try { this.toggle(false); } catch (err) {}
            }
        };

        // Camera Vertical State (use robust pointer listeners so state clears on cancel/leave)
        const upBtn = document.getElementById('ed-cam-up');
        const downBtn = document.getElementById('ed-cam-down');

        const setEdCamUp = (v) => { window._edCamUp = !!v; };
        const setEdCamDown = (v) => { window._edCamDown = !!v; };

        // Helper to attach the full set of pointer/touch events so the flag is cleared in all cases
        const bindHoldButton = (el, onStart, onEnd) => {
            if (!el) return;
            el.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                onStart(true);
                // capture pointer so we still receive cancel/leave events even if pointer moves off element
                try { el.setPointerCapture && el.setPointerCapture(ev.pointerId); } catch (e) {}
            });
            const endHandler = (ev) => {
                try { el.releasePointerCapture && el.releasePointerCapture(ev.pointerId); } catch (e) {}
                onEnd(false);
            };
            el.addEventListener('pointerup', endHandler);
            el.addEventListener('pointercancel', endHandler);
            el.addEventListener('pointerleave', endHandler);
            el.addEventListener('pointerout', endHandler);
            // also handle mouseleave for older browsers/fallback
            el.addEventListener('mouseleave', endHandler);
            // Accessibility: keyboard activation (Space/Enter) should toggle as well
            el.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onStart(true); }
            });
            el.addEventListener('keyup', (e) => {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onEnd(false); }
            });
        };

        bindHoldButton(upBtn, setEdCamUp, setEdCamUp);
        bindHoldButton(downBtn, setEdCamDown, setEdCamDown);

        // Setup Paint Palette (32 swatches)
        for (let i = 0; i < 32; i++) {
            const swatch = document.createElement('div');
            const color = new THREE.Color().setHSL(i / 32, 0.8, 0.6);
            const hex = `#${color.getHexString()}`;
            swatch.style.cssText = `width:100%; aspect-ratio:1; background:${hex}; border-radius:4px; cursor:pointer; border:1px solid rgba(255,255,255,0.1);`;
            swatch.dataset.hex = hex;
            swatch.onclick = () => {
                this.setCurrentColor(hex);
            };
            this.paintGrid.appendChild(swatch);
        }
        // ensure UI reflects current color state
        this.setCurrentColor(this.currentColor);
        // Right-click on canvas to sample a color from a part (contextmenu) - non-destructive
        const canvas = (this.game && this.game.renderer && this.game.renderer.domElement) ? this.game.renderer.domElement : null;
        if (canvas) {
            canvas.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                // raycast and sample color of the first custom object hit
                const mouse = new THREE.Vector2((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
                this.raycaster.setFromCamera(mouse, this.game.camera);
                const intersects = this.raycaster.intersectObjects(this.game.scene.children, true);
                for (const it of intersects) {
                    let o = it.object;
                    while (o) {
                        if (o.userData && o.userData.isCustom && o.material && o.material.color) {
                            const sampled = `#${new THREE.Color(o.material.color.getHex()).getHexString()}`;
                            this.setCurrentColor(sampled);
                            return;
                        }
                        o = o.parent;
                    }
                }
            }, { passive: false });
        }

        // Scene pointer events are bound when the editor is activated, and removed on deactivate.
        // This prevents stray or duplicate handlers from running while editor is inactive.
    }

    setTool(tool) {
        this.activeTool = tool;
        this.toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        
        // Show/hide sub-panels
        document.getElementById('ed-panel-place').style.display = (tool === 'place') ? 'flex' : 'none';
        document.getElementById('ed-panel-paint').style.display = (tool === 'paint') ? 'block' : 'none';

        if (tool === 'export') this.exportLevel();
        if (tool === 'import') this.importLevel();

        this.updateGizmos();
    }

    toggle(state) {
        this.active = state;
        this.ui.style.display = state ? 'block' : 'none';
        // Bind/unbind scene pointer events only while editor is active to avoid duplicate handlers and freezes.
        if (state) {
            this.bindScenePointerEvents();
        } else {
            this.unbindScenePointerEvents();
        }

        // Keep fullscreen button visible and interactive while editor is active
        const fsBtn = document.getElementById('fullscreen-button');
        if (fsBtn) {
            if (state) {
                fsBtn.style.zIndex = '999';
                fsBtn.style.pointerEvents = 'auto';
            } else {
                // restore to original stacking/pointer state
                fsBtn.style.zIndex = '121';
                fsBtn.style.pointerEvents = '';
            }
        }

        // Ensure controls exist
        // Always ensure controls exist and get the right mode/state
        try {
            if (!this.game.controls) {
                // defensive: nothing more to do if controls missing
            } else {
                // Keep radius stable when entering editor so view doesn't jump
                if (state) {
                    // Initialize editor-specific camera state from current player camera so editor adjustments are isolated
                    this.game.controls.editorRadius = this.game.controls.radius = (this.game.controls.radius || this.game.controls.radiusDesired || 8);
                    this.game.controls.editorPitchDeg = this.game.controls.pitchDeg;
                    this.game.controls.editorTheta = this.game.controls.theta;
                    // Switch to editor mode and enable input so joystick/camera work immediately
                    this.game.controls.setMode && this.game.controls.setMode('editor');
                    this.game.controls.enabled = true;

                    // In editor, allow joystick to be used for free-flight camera on touch devices.
                    const joy = document.getElementById('joystick-container');
                    if (joy) {
                        joy.style.display = this.game.controls.isMobile ? 'block' : 'none';
                        joy.style.pointerEvents = this.game.controls.isMobile ? 'auto' : 'none';
                    }
                    // Hide jump button to avoid accidental jumps while editing
                    const jb = document.getElementById('jump-button');
                    if (jb) {
                        jb.style.display = 'none';
                        jb.style.pointerEvents = 'none';
                    }

                    // Editor should not be tied to any gameplay ball; clear reference so camera collisions ignore a missing ball
                    try { this.game.controls.ballMesh = null; } catch (e) {}
                } else {
                    // Exiting editor -> return to player mode
                    this.game.controls.setMode && this.game.controls.setMode('player');
                    this.game.controls.enabled = true;

                    // make sure we clear selection/gizmos
                    this.deselect();
                    this.clearGizmos();

                    // Reset player camera orientation to a sensible default for gameplay / menu demo
                    // Note: editor camera changes do NOT overwrite player camera since they are now separate.
                    this.game.controls.pitchDeg = 25;
                    this.game.controls.theta = 0;
                    this.game.controls.radiusDesired = THREE.MathUtils.clamp(this.game.controls.radiusDesired || this.game.controls.radius || 8, this.game.controls.minRadius || 0.05, this.game.controls.maxRadius || 20);

                    // Restore the menu demo visuals if present
                    if (this.game.menuDemo && this.game.menuDemo.group) this.game.menuDemo.group.visible = true;

                    // Restore on-screen UI according to device state
                    const isMobile = this.game.controls.isMobile;
                    const jumpBtn = document.getElementById('jump-button');
                    const joy = document.getElementById('joystick-container');

                    if (jumpBtn) {
                        jumpBtn.style.display = isMobile ? 'flex' : 'none';
                        jumpBtn.style.pointerEvents = isMobile ? 'auto' : 'none';
                    }
                    if (joy) {
                        // keep the joystick hidden by default when leaving editor; InputHandler will show it on touchstart
                        joy.style.display = 'none';
                        joy.style.pointerEvents = 'none';
                    }

                    // Clear editor camera flags
                    window._edCamUp = false;
                    window._edCamDown = false;

                    // Restore controls' ball reference if a level/ball exists so gameplay controls resume correctly
                    try {
                        if (this.game.levelManager && this.game.levelManager.ball) {
                            this.game.controls.ballMesh = this.game.levelManager.ball;
                        } else {
                            this.game.controls.ballMesh = null;
                        }
                    } catch (e) {}

                    // If the main menu demo is active, put the camera into a sensible demo vantage to avoid weird offsets
                    try {
                        if (this.game.menuVisible && this.game.menuDemo && this.game.menuDemo.group) {
                            // place camera to view the right-side demo platform and look at its center
                            const demoCenter = this.game.menuDemo.group.position.clone();
                            // offset back and up a bit relative to demo
                            const camPos = (this.game.menuDemo && this.game.menuDemo.demoCamPos) ? this.game.menuDemo.demoCamPos.clone() : new THREE.Vector3(10, 8, -10);
                            this.game.camera.position.copy(camPos);
                            this.game.camera.lookAt(demoCenter);
                            // also nudge internal orbit state so subsequent editor entries/exit behave predictably
                            if (this.game.controls) {
                                this.game.controls.pitchDeg = 25;
                                this.game.controls.theta = 0;
                            }
                        }
                    } catch (e) {
                        // ignore camera reset errors
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to switch editor mode cleanly', e);
        }

        // Shared setup when enabling editor for a fresh scene
        if (state) {
            try {
                // Clear level visuals / physics and enter editor with physics paused
                this.game.levelManager.clearLevel();
                this.game.levelManager._levelLoadedFromMenu = true;
            } catch(e) {}
            // Pause physics updates so objects stop completely during editing
            try { if (this.game.physics && typeof this.game.physics.pause === 'function') this.game.physics.pause(); } catch(e){}

            this.setTool('place');
            // Move editor camera to a sensible editor vantage
            try { this.game.camera.position.set(0, 10, 20); } catch(e){}
            try { this.game.controls.editorPitchDeg = 25; } catch(e){}
            try { this.game.controls.editorTheta = 0; } catch(e){}
            // Hide main demo objects
            if (this.game.menuDemo && this.game.menuDemo.group) {
                this.game.menuDemo.group.visible = false;
            }
        } else {
            // When leaving editor ensure physics resumes for normal gameplay/demo
            try { if (this.game.physics && typeof this.game.physics.resume === 'function') this.game.physics.resume(); } catch(e){}
        }
    }

    spawnPart(type) {
        // Place 10 units forward from camera
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.game.camera.quaternion);
        const spawnPos = this.game.camera.position.clone().add(dir.multiplyScalar(10));
        
        let mesh;
        let data = { type, color: 0x44aa88, scale: [4, 1, 4] };

        // Enforce single player spawn: if placing a 'ball' remove existing editor-spawn marker(s)
        if (type === 'ball') {
            for (let i = this.customParts.length - 1; i >= 0; i--) {
                if (this.customParts[i].type === 'ball') {
                    try { this.game.scene.remove(this.customParts[i].mesh); } catch (e) {}
                    this.customParts.splice(i, 1);
                }
            }
        }

        if (type === 'platform') {
            mesh = this.game.levelManager.createPlatform(spawnPos.x, spawnPos.y, spawnPos.z, 4, 1, 4, data.color);
        } else if (type === 'moving') {
            mesh = this.game.levelManager.createMovingPlatform(spawnPos.x, spawnPos.y, spawnPos.z, 4, 1, 4, data.color, [spawnPos.clone(), spawnPos.clone().add(new THREE.Vector3(0, 5, 0))]);
        } else if (type === 'jump') {
            mesh = this.game.levelManager.createJumpPad(spawnPos.x, spawnPos.y, spawnPos.z);
        } else if (type === 'ball') {
            // For editor placement, create a visual marble (no physics body) so designers can position the spawn point
            const mat = this.game.sceneRenderer.createBallMaterial({ color: 0xffffff, shininess: 0.5, textureType: 'noise', textureAlpha: 0.3 });
            mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 24), mat);
            mesh.position.copy(spawnPos);
            mesh.userData.editorSpawnMarker = true;
            this.game.scene.add(mesh);
            data.spawn = [spawnPos.x, spawnPos.y, spawnPos.z];
        } else if (type === 'checkpoint') {
            mesh = this.game.levelManager.createCheckpoint(spawnPos.x, spawnPos.y, spawnPos.z);
            data.spawn = [spawnPos.x, spawnPos.y, spawnPos.z];
        } else if (type === 'win') {
            // create a win-area visual using the level manager helper so visuals match runtime
            this.game.levelManager.createWinArea(spawnPos.x, spawnPos.y, spawnPos.z);
            mesh = this.game.levelManager.winArea;
            data.spawn = [spawnPos.x, spawnPos.y, spawnPos.z];
        } else if (type === 'deco' || type === 'decomarble' || type === 'decomarble_spawner' || type === 'decomarbleSpawner') {
            // Deco Marble Spawner: visual-only spawner that can be parsed by run()
            const g = new THREE.Group();
            const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffaa88, emissive: 0xffaa88, emissiveIntensity: 0.12 }));
            s.position.set(0, 0.35, 0);
            g.add(s);
            const plat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 18), new THREE.MeshStandardMaterial({ color: 0x222222 }));
            plat.rotation.x = Math.PI / 2;
            g.add(plat);
            g.position.copy(spawnPos);
            mesh = g;
            data.spawn = [spawnPos.x, spawnPos.y, spawnPos.z];
            data.type = 'deco';
        } else if (type === 'spinning') {
            // Spinning platform (visual + will be converted to a kinematic moving platform on run)
            // create a short rotating platform visual in-editor
            const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 3.2), this.game.sceneRenderer.createPlatformMaterial(0x8899bb));
            p.position.copy(spawnPos);
            // mark as a spinning platform and store a small path for runtime conversion
            mesh = p;
            data.type = 'spinning';
            data.spawn = [spawnPos.x, spawnPos.y, spawnPos.z];
            data.spinRadius = 0.0; // unused visually; runtime will use a two-point shuttle path if desired
        }

        if (mesh) {
            mesh.userData.isCustom = true;
            this.customParts.push({ mesh, type: data.type || type, data });
            this.selectPart(mesh);
        }
    }

    selectPart(mesh) {
        this.selectedPart = mesh;
        this.selectionInfo.style.display = 'block';
        const data = this.customParts.find(p => p.mesh === mesh);
        this.partNameDisplay.innerText = data ? data.type : 'Mesh';
        this.updateGizmos();
    }

    // Bind scene pointer events (attach stable handlers so they can be removed later)
    bindScenePointerEvents() {
        if (this._boundPointerDown) return;
        this._boundPointerDown = (e) => this.onPointerDown(e);
        this._boundPointerMove = (e) => this.onPointerMove(e);
        this._boundPointerUp = () => this.onPointerUp();
        // Prevent native context menu while interacting with the editor canvas to avoid right-click interruptions
        this._boundContextMenu = (ev) => {
            // Only prevent default when editor is active and the event originates from our renderer canvas
            try {
                if (this.active && ev.target === (this.game && this.game.renderer && this.game.renderer.domElement)) {
                    ev.preventDefault();
                }
            } catch (err) {}
        };

        if (this.game && this.game.renderer && this.game.renderer.domElement) {
            const canvas = this.game.renderer.domElement;
            canvas.addEventListener('pointerdown', this._boundPointerDown);
            canvas.addEventListener('pointermove', this._boundPointerMove);
            // Block context menu on the editor canvas while editor is active
            canvas.addEventListener('contextmenu', this._boundContextMenu);
        }
        window.addEventListener('pointerup', this._boundPointerUp);
    }

    unbindScenePointerEvents() {
        try {
            if (!this._boundPointerDown) return;
            if (this.game && this.game.renderer && this.game.renderer.domElement) {
                this.game.renderer.domElement.removeEventListener('pointerdown', this._boundPointerDown);
                this.game.renderer.domElement.removeEventListener('pointermove', this._boundPointerMove);
            }
            window.removeEventListener('pointerup', this._boundPointerUp);
        } catch (e) {
            console.warn('Failed to unbind editor pointer events', e);
        } finally {
            this._boundPointerDown = null;
            this._boundPointerMove = null;
            this._boundPointerUp = null;
        }
    }

    deselect() {
        this.selectedPart = null;
        this.selectionInfo.style.display = 'none';
        this.clearGizmos();
    }

    deleteSelected() {
        if (!this.selectedPart) return;
        // If part is part of a linked group, remove all items with the same customGroupId
        const gid = this.selectedPart.userData && this.selectedPart.userData.customGroupId;
        if (gid) {
            // remove all matching customParts and scene objects
            for (let i = this.customParts.length - 1; i >= 0; i--) {
                const p = this.customParts[i];
                const m = p.mesh;
                if (m && m.userData && m.userData.customGroupId === gid) {
                    try { this.game.scene.remove(m); } catch(e){}
                    this.customParts.splice(i, 1);
                }
            }
            // also remove any stray lines/markers with userData.customGroupId
            this.game.scene.traverse((o) => {
                try {
                    if (o && o.userData && o.userData.customGroupId === gid) {
                        try { this.game.scene.remove(o); } catch(e){}
                    }
                } catch(e){}
            });
            this.deselect();
            return;
        }

        // otherwise remove single part
        const index = this.customParts.findIndex(p => p.mesh === this.selectedPart);
        if (index !== -1) {
            try { this.game.scene.remove(this.selectedPart); } catch(e){}
            this.customParts.splice(index, 1);
        }
        this.deselect();
    }

    clearGizmos() {
        while(this.gizmoGroup.children.length > 0) {
            const child = this.gizmoGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            this.gizmoGroup.remove(child);
        }
    }

    updateGizmos() {
        this.clearGizmos();
        if (!this.selectedPart || this.activeTool === 'place' || this.activeTool === 'paint') return;

        const pos = this.selectedPart.position;
        this.gizmoGroup.position.copy(pos);
        this.gizmoGroup.scale.set(1.5, 1.5, 1.5); // Make gizmos bigger and clearer

        if (this.activeTool === 'move') {
            this.addArrow('x', new THREE.Vector3(1, 0, 0));
            this.addArrow('x_neg', new THREE.Vector3(-1, 0, 0));
            this.addArrow('y', new THREE.Vector3(0, 1, 0));
            this.addArrow('y_neg', new THREE.Vector3(0, -1, 0));
            this.addArrow('z', new THREE.Vector3(0, 0, 1));
            this.addArrow('z_neg', new THREE.Vector3(0, 0, -1));
        } else if (this.activeTool === 'resize') {
            this.addHandle('x', new THREE.Vector3(1, 0, 0));
            this.addHandle('x_neg', new THREE.Vector3(-1, 0, 0));
            this.addHandle('y', new THREE.Vector3(0, 1, 0));
            this.addHandle('y_neg', new THREE.Vector3(0, -1, 0));
            this.addHandle('z', new THREE.Vector3(0, 0, 1));
            this.addHandle('z_neg', new THREE.Vector3(0, 0, -1));
        } else if (this.activeTool === 'rotate') {
            // TorusGeometry is initially in XY plane.
            // Ring around X: rotate 90 deg around Y to be in YZ plane
            this.addRing('x', new THREE.Euler(0, Math.PI / 2, 0));
            // Ring around Y: rotate 90 deg around X to be in XZ plane
            this.addRing('y', new THREE.Euler(Math.PI / 2, 0, 0));
            // Ring around Z: already in XY plane
            this.addRing('z', new THREE.Euler(0, 0, 0));
        }
    }

    addArrow(id, dir) {
        // Place an arrow handle flush to the part surface in the given direction.
        const arrow = new THREE.Group();
        const axisKey = id[0];
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5), this.gizmoMats[axisKey]);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4), this.gizmoMats[axisKey]);
        stem.position.y = 0.75;
        head.position.y = 1.7;
        arrow.add(stem, head);

        // Orient the arrow toward the desired direction and offset it to sit on the part surface
        arrow.lookAt(dir);
        arrow.rotateX(Math.PI / 2);

        // compute a sensible offset so arrow sits on the mesh surface instead of centered
        try {
            const part = this.selectedPart;
            if (part && part.geometry) {
                // ensure bounding box exists
                if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
                const bb = part.geometry.boundingBox; // in local space
                // get half-extents in world scale to compute surface offset
                const half = new THREE.Vector3(
                    (bb.max.x - bb.min.x) * 0.5 * (part.scale ? part.scale.x : 1),
                    (bb.max.y - bb.min.y) * 0.5 * (part.scale ? part.scale.y : 1),
                    (bb.max.z - bb.min.z) * 0.5 * (part.scale ? part.scale.z : 1)
                );
                // choose offset along dir's major component
                const absDir = dir.clone().set(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));
                let surfaceOffset = 0;
                if (absDir.x >= absDir.y && absDir.x >= absDir.z) surfaceOffset = half.x + 0.35;
                else if (absDir.y >= absDir.x && absDir.y >= absDir.z) surfaceOffset = half.y + 0.35;
                else surfaceOffset = half.z + 0.35;
                arrow.position.copy(dir.clone().normalize().multiplyScalar(surfaceOffset));
            } else {
                arrow.position.copy(dir.clone().multiplyScalar(2));
            }
        } catch (e) {
            arrow.position.copy(dir.clone().multiplyScalar(2));
        }

        arrow.userData = { gizmo: true, type: 'move', axis: id };
        this.gizmoGroup.add(arrow);
    }

    addHandle(id, dir) {
        // Place a square handle on the face/surface corresponding to 'dir' instead of a fixed radius.
        const axisKey = id[0];
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), this.gizmoMats[axisKey]);

        // Compute an appropriate placement at the mesh surface using geometry bounding box & scale
        try {
            const part = this.selectedPart;
            if (part && part.geometry) {
                if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
                const bb = part.geometry.boundingBox;
                const half = new THREE.Vector3(
                    (bb.max.x - bb.min.x) * 0.5 * (part.scale ? part.scale.x : 1),
                    (bb.max.y - bb.min.y) * 0.5 * (part.scale ? part.scale.y : 1),
                    (bb.max.z - bb.min.z) * 0.5 * (part.scale ? part.scale.z : 1)
                );
                // choose offset along the principal axis of dir
                const absDir = new THREE.Vector3(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));
                let surfaceOffset = 0;
                if (absDir.x >= absDir.y && absDir.x >= absDir.z) surfaceOffset = half.x + 0.38;
                else if (absDir.y >= absDir.x && absDir.y >= absDir.z) surfaceOffset = half.y + 0.38;
                else surfaceOffset = half.z + 0.38;
                handle.position.copy(dir.clone().normalize().multiplyScalar(surfaceOffset));
            } else {
                handle.position.copy(dir.clone().multiplyScalar(2));
            }
        } catch (e) {
            handle.position.copy(dir.clone().multiplyScalar(2));
        }

        handle.userData = { gizmo: true, type: 'resize', axis: id };
        this.gizmoGroup.add(handle);
    }

    addRing(axis, euler) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.08, 16, 64), this.gizmoMats[axis]);
        ring.rotation.copy(euler);
        ring.userData = { gizmo: true, type: 'rotate', axis: axis };
        this.gizmoGroup.add(ring);
    }

    onPointerDown(e) {
        if (!this.active) return;
        const mouse = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.raycaster.setFromCamera(mouse, this.game.camera);
        const intersects = this.raycaster.intersectObjects(this.game.scene.children, true);

        // Helper: walk up parent chain to find an ancestor with a given flag
        const findAncestorFlag = (obj, flagName) => {
            let o = obj;
            while (o) {
                try { if (o.userData && o.userData[flagName]) return o; } catch (e) {}
                o = o.parent;
            }
            return null;
        };

        // Check gimzo hits first
        let gizmoHit = null;
        for (const it of intersects) {
            const giz = findAncestorFlag(it.object, 'gizmo');
            if (giz) { gizmoHit = { object: giz, intersect: it }; break; }
        }
        if (gizmoHit) {
            window._isGizmoDragging = true;
            this.draggingGizmo = gizmoHit.object;
            this.dragStartPos = this.selectedPart ? new THREE.Vector3().copy(this.selectedPart.position) : new THREE.Vector3();
            this.dragStartMouse = mouse.clone();
            this.dragStartObjScale = this.selectedPart && this.selectedPart.scale ? this.selectedPart.scale.clone() : new THREE.Vector3(1,1,1);
            this.dragStartObjRot = this.selectedPart && this.selectedPart.rotation ? this.selectedPart.rotation.clone() : new THREE.Euler();
            return;
        }

        // Find a hit part (ignore gizmo children)
        let partHit = null;
        for (const it of intersects) {
            const isUnderGizmo = !!findAncestorFlag(it.object, 'gizmo');
            if (isUnderGizmo) continue;
            if (it.object.userData && it.object.userData.isCustom) { partHit = it; break; }
        }

        if (partHit) {
            if (this.activeTool === 'paint' && this.currentColor) {
                // start painting on pointerdown and allow drag-to-paint
                this.isPainting = true;
                this.applyColorToObject(partHit.object, this.currentColor);
                return;
            } else if (this.activeTool === 'configure') {
                this.selectPart(partHit.object);
                this._openConfigFor(partHit.object);
                return;
            } else {
                this.selectPart(partHit.object);
                return;
            }
        } else {
            // Do NOT deselect when the user is initiating camera rotation or moving joystick — only deselect for explicit clicks/taps on empty space.
            const controls = this.game && this.game.controls;
            const isCameraDragStart = (typeof e.button !== 'undefined' && e.button === 2) || (controls && (controls.joystickVisible || controls.cameraTouchId !== null || controls._rightMouseDown));
            if (!e.shiftKey && !isCameraDragStart) {
                this.deselect();
            }
        }
    }

    onPointerMove(e) {
        // If painting, allow continuous paint on drag even when not interacting with gizmos
        if (this.active && this.isPainting && this.activeTool === 'paint') {
            const mouse = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
            this.raycaster.setFromCamera(mouse, this.game.camera);
            const intersects = this.raycaster.intersectObjects(this.game.scene.children, true);
            for (const it of intersects) {
                let o = it.object;
                // find a custom-painted mesh ancestor
                while (o) {
                    if (o.userData && o.userData.isCustom && o.material && o.material.color) {
                        this.applyColorToObject(o, this.currentColor);
                        // only paint the topmost hit
                        return;
                    }
                    o = o.parent;
                }
            }
            return;
        }

        // Otherwise default gizmo drag behavior
        if (!this.active || !this.draggingGizmo) return;
        const mouse = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        const delta = mouse.clone().sub(this.dragStartMouse);
        
        const axis = this.draggingGizmo.userData.axis;
        const type = this.draggingGizmo.userData.type;
        const step = 0.5;

        if (type === 'move') {
            const movementX = delta.x * 25;
            const movementY = delta.y * 25;
            if (axis.startsWith('x')) this.selectedPart.position.x = Math.round((this.dragStartPos.x + (axis.includes('neg') ? -movementX : movementX)) / step) * step;
            if (axis.startsWith('y')) this.selectedPart.position.y = Math.round((this.dragStartPos.y + (axis.includes('neg') ? -movementY : movementY)) / step) * step;
            if (axis.startsWith('z')) this.selectedPart.position.z = Math.round((this.dragStartPos.z + (axis.includes('neg') ? -movementX : movementX)) / step) * step;
        } else if (type === 'resize') {
            const horiz = delta.x * 15;
            const vert = -delta.y * 15; // invert vertical so upward drag grows the axis

            if (axis.startsWith('x')) {
                const sign = axis.includes('neg') ? -1 : 1;
                this.selectedPart.scale.x = Math.max(0.1, this.dragStartObjScale.x + sign * horiz);
            }
            if (axis.startsWith('y')) {
                const sign = axis.includes('neg') ? -1 : 1;
                this.selectedPart.scale.y = Math.max(0.1, this.dragStartObjScale.y + sign * vert);
            }
            if (axis.startsWith('z')) {
                const sign = axis.includes('neg') ? -1 : 1;
                this.selectedPart.scale.z = Math.max(0.1, this.dragStartObjScale.z + sign * vert);
            }
        } else if (type === 'rotate') {
            const rotChange = delta.x * Math.PI * 2;
            if (axis === 'x') this.selectedPart.rotation.x = this.dragStartObjRot.x + rotChange;
            if (axis === 'y') this.selectedPart.rotation.y = this.dragStartObjRot.y + rotChange;
            if (axis === 'z') this.selectedPart.rotation.z = this.dragStartObjRot.z + rotChange;
        }

        this.gizmoGroup.position.copy(this.selectedPart.position);

        // sync linked dotted lines if this mesh is a marker or moving platform
        try {
            const gid = this.selectedPart.userData && this.selectedPart.userData.customGroupId;
            if (gid) {
                this.game.scene.traverse((o) => {
                    if (!o) return;
                    try {
                        if (o.type === 'Line' && o.userData && o.userData.customGroupId === gid) {
                            const objs = [];
                            this.game.scene.traverse((x) => { if (x && x.userData && x.userData.customGroupId === gid) objs.push(x); });
                            let markerA = objs.find(o => o.geometry && o.geometry.type === 'SphereGeometry' && o.userData.isMarker);
                            let markerB = objs.filter(o => o.geometry && o.geometry.type === 'SphereGeometry' && o.userData.isMarker).filter(m => m !== markerA)[0];
                            if (markerA && markerB) {
                                const pts = [ markerA.position.clone(), markerB.position.clone() ];
                                if (o.geometry && o.geometry.setFromPoints) {
                                    o.geometry.setFromPoints(pts);
                                    o.computeLineDistances && o.computeLineDistances();
                                } else {
                                    o.geometry = new THREE.BufferGeometry().setFromPoints(pts);
                                    o.computeLineDistances && o.computeLineDistances();
                                }
                            }
                        }
                    } catch(e){}
                });
            }
        } catch (e) {}

        // If the selected part has an associated static physics body (standard platforms), update its collision body
        try {
            if (this.selectedPart && this.selectedPart.userData && this.selectedPart.userData.isCustom) {
                if (this.game && this.game.levelManager && typeof this.game.levelManager.updatePlatformBody === 'function') {
                    this.game.levelManager.updatePlatformBody(this.selectedPart);
                }
            }
        } catch (e) {
            console.warn('Failed to sync editor transform to physics body', e);
        }
    }

    onPointerUp() {
        // stop painting if active
        this.isPainting = false;
        this.draggingGizmo = null;
        window._isGizmoDragging = false;
    }

    // Helper: set current color and update UI swatches
    setCurrentColor(hex) {
        this.currentColor = hex;
        // update swatch UI
        const swatches = Array.from(this.paintGrid.querySelectorAll('div'));
        swatches.forEach(s => {
            if (s.dataset && s.dataset.hex && s.dataset.hex.toLowerCase() === hex.toLowerCase()) {
                s.style.border = '2px solid white';
            } else {
                s.style.border = '1px solid rgba(255,255,255,0.1)';
            }
        });
        // mark selection visually in customizer preview if present
        if (this.selectedPart) {
            try {
                if (this.selectedPart.material && this.selectedPart.material.color) {
                    // don't override metadata until user paints or saves; only a visual cue here
                    // this.selectedPart.material.color.set(hex);
                }
            } catch (e) {}
        }
    }

    applyColorToObject(obj, hex) {
        try {
            if (!obj || !obj.material || !obj.material.color) return;
            obj.material.color.set(hex);
            // find customParts entry and update its stored color data for persistence/export
            const p = this.customParts.find(pp => pp.mesh === obj);
            if (p) {
                p.data = p.data || {};
                p.data.color = hex;
            }
        } catch (e) {}
    }

    exportLevel() {
        const data = this.customParts.map(p => {
            const base = {
                type: p.type,
                pos: p.mesh.position.toArray(),
                scale: p.mesh.scale ? p.mesh.scale.toArray() : [1,1,1],
                rot: p.mesh.rotation ? p.mesh.rotation.toArray() : [0,0,0],
                color: (p.mesh.material && p.mesh.material.color) ? p.mesh.material.color.getHex() : (p.data && p.data.color ? p.data.color : 0xffffff)
            };
            // include extra stored spawn/location data for items like ball/checkpoint/win
            if (p.data && p.data.spawn) base.spawn = p.data.spawn;
            return base;
        });
        const blob = JSON.stringify(data);
        const input = prompt("Level Data (Copy this):", blob);
    }

    // ---- Configure panel helpers ----
    _openConfigFor(mesh) {
        if (!mesh) return;
        this._cfgPanel.style.display = 'block';
        this._cfgTarget = mesh;

        // If mesh belongs to a linked moving-platform set, get group meta
        const gid = mesh.userData && mesh.userData.customGroupId;
        let meta = null;
        if (gid) {
            // find customParts entry that contains the meta for moving
            meta = this.customParts.find(p => p.type === 'moving' && p.data && p.data.mesh && p.data.mesh.userData && p.data.mesh.userData.customGroupId === gid);
            if (meta && meta.data) meta = meta.data;
        }

        // Clear contents
        this._cfgContents.innerHTML = '';

        // Jump pad configuration
        if (mesh.userData && mesh.userData.isJumpPad) {
            const current = mesh.userData.cfg || { angleDeg: 0, power: 12, straightUp: false };
            this._cfgContents.innerHTML = `
                <div style="font-size:13px;margin-bottom:6px;">Jump Pad</div>
                <label style="font-size:12px;">Angle (deg):</label>
                <input id="cfg-angle" type="number" value="${current.angleDeg}" style="width:100%;margin:6px 0;padding:6px;">
                <label style="font-size:12px;">Power:</label>
                <input id="cfg-power" type="number" value="${current.power}" style="width:100%;margin:6px 0;padding:6px;">
                <label style="display:flex;align-items:center;gap:8px;margin-top:6px;"><input id="cfg-straight" type="checkbox" ${current.straightUp ? 'checked' : ''}>Launch Straight Up</label>
            `;
            return;
        }

        // Moving platform configuration
        if (meta && meta.type === 'moving') {
            const cfg = meta.data || { mode: 'move', speed: 0.25 };
            this._cfgContents.innerHTML = `
                <div style="font-size:13px;margin-bottom:6px;">Moving Platform</div>
                <label style="font-size:12px;">Mode:</label>
                <select id="cfg-mode" style="width:100%;padding:6px;margin:6px 0;">
                    <option value="move" ${cfg.mode === 'move' ? 'selected' : ''}>Move (A↔B)</option>
                    <option value="rotate" ${cfg.mode === 'rotate' ? 'selected' : ''}>Rotate In Place</option>
                </select>
                <label style="font-size:12px;">Speed:</label>
                <input id="cfg-speed" type="number" step="0.01" value="${cfg.speed}" style="width:100%;margin:6px 0;padding:6px;">
            `;
            return;
        }

        // Generic fallback: no config
        this._cfgContents.innerHTML = `<div style="font-size:12px;">No configurable options for this part.</div>`;
    }

    _applyConfig() {
        const mesh = this._cfgTarget;
        if (!mesh) return this._closeConfig();

        // Jump pad apply
        if (mesh.userData && mesh.userData.isJumpPad) {
            const angleEl = document.getElementById('cfg-angle');
            const powerEl = document.getElementById('cfg-power');
            const straightEl = document.getElementById('cfg-straight');
            const angle = angleEl ? parseFloat(angleEl.value) : 0;
            const power = powerEl ? parseFloat(powerEl.value) : 12;
            const straight = straightEl ? straightEl.checked : false;
            mesh.userData.cfg = { angleDeg: angle, power, straightUp: straight };

            // Visualize: if straightUp show a dot above pad, else show direction arrow
            // Clear existing decorators
            if (mesh._cfgDeco) { try { mesh.remove(mesh._cfgDeco); } catch(e){} mesh._cfgDeco = null; }
            if (straight) {
                const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
                dot.position.set(0, 0.12, 0);
                mesh.add(dot);
                mesh._cfgDeco = dot;
            } else {
                // create directional arrow line
                const angRad = THREE.MathUtils.degToRad(angle);
                const dir = new THREE.Vector3(Math.sin(angRad), 0, Math.cos(angRad)).normalize();
                const arrowGeo = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(0,0.06,0), dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0,0.06,0)) ]);
                const arrow = new THREE.Line(arrowGeo, new THREE.LineBasicMaterial({ color: 0xffeeff }));
                mesh.add(arrow);
                mesh._cfgDeco = arrow;
            }
            // store config in mesh for runtime usage
            return this._closeConfig();
        }

        // Moving platform apply
        const gid = mesh.userData && mesh.userData.customGroupId;
        if (gid) {
            const modeEl = document.getElementById('cfg-mode');
            const speedEl = document.getElementById('cfg-speed');
            const mode = modeEl ? modeEl.value : 'move';
            const speed = speedEl ? parseFloat(speedEl.value) : 0.25;

            // find meta and set
            const parentMeta = this.customParts.find(p => p.type === 'moving' && p.data && p.data.mesh && p.data.mesh.userData && p.data.mesh.userData.customGroupId === gid);
            if (parentMeta && parentMeta.data) {
                parentMeta.data.data.mode = mode;
                parentMeta.data.data.speed = speed;
                // If rotate selected, hide markers visually in editor (but do not delete them) to match run behavior
                if (mode === 'rotate') {
                    // remove markers & line from scene (keep metadata)
                    try {
                        if (parentMeta.data.markerA) parentMeta.data.markerA.visible = false;
                        if (parentMeta.data.markerB) parentMeta.data.markerB.visible = false;
                        if (parentMeta.data.line) parentMeta.data.line.visible = false;
                    } catch(e){}
                } else {
                    try {
                        if (parentMeta.data.markerA) parentMeta.data.markerA.visible = true;
                        if (parentMeta.data.markerB) parentMeta.data.markerB.visible = true;
                        if (parentMeta.data.line) parentMeta.data.line.visible = true;
                    } catch(e){}
                }
            }
            return this._closeConfig();
        }

        // fallback
        this._closeConfig();
    }

    _closeConfig() {
        this._cfgPanel.style.display = 'none';
        this._cfgTarget = null;
    }

    /**
     * run()
     * Compile the editor scene into a playable state:
     * - resume physics
     * - ensure only one player spawn (use marker if present or default to camera-forward)
     * - create gameplay objects where necessary (convert spinning/deco placeholders to runtime objects)
     * - spawn the player marble at the spawn marker and remove/hide the spawn marker visual
     */
    run() {
        // Resume physics first so any created runtime bodies will be simulated
        try { if (this.game.physics && typeof this.game.physics.resume === 'function') this.game.physics.resume(); } catch(e){}

        // Ensure at most one player spawn exists: find first ball part, otherwise create one at camera forward
        let spawnPart = this.customParts.find(p => p.type === 'ball');
        if (!spawnPart) {
            // create a default spawn at camera-forward
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.game.camera.quaternion);
            const spawnPos = this.game.camera.position.clone().add(dir.multiplyScalar(8));
            this.game.levelManager.createBall(spawnPos.x, spawnPos.y, spawnPos.z);
        } else {
            // Use spawnPart.data.spawn position to create the runtime ball
            const s = spawnPart.data && spawnPart.data.spawn ? spawnPart.data.spawn : spawnPart.mesh.position.toArray();
            // ensure we only spawn one player ball
            try { this.game.levelManager.createBall(s[0], s[1], s[2]); } catch(e){}
            // hide editor spawn marker if present
            try {
                if (spawnPart.mesh && spawnPart.mesh.userData && spawnPart.mesh.userData.editorSpawnMarker) {
                    this.game.scene.remove(spawnPart.mesh);
                }
            } catch(e){}
        }

        // Convert editor parts to runtime objects:
        for (const p of this.customParts.slice()) {
            try {
                // moving group meta stored as p.type === 'moving' with p.data.data containing settings
                if (p.type === 'moving' && p.data) {
                    const meta = p.data;
                    const gid = meta.mesh.userData.customGroupId;
                    const mode = meta.data.mode || 'move';
                    const speed = meta.data.speed || 0.25;
                    if (mode === 'move') {
                        // find marker positions
                        const A = meta.markerA ? meta.markerA.position.clone() : meta.mesh.position.clone().add(new THREE.Vector3(-2,0,0));
                        const B = meta.markerB ? meta.markerB.position.clone() : meta.mesh.position.clone().add(new THREE.Vector3(2,0,0));
                        try {
                            this.game.levelManager.createMovingPlatform(meta.mesh.position.x, meta.mesh.position.y, meta.mesh.position.z, meta.mesh.scale.x || 3.2, meta.mesh.scale.y || 0.6, meta.mesh.scale.z || 3.2, meta.data.color || 0x8899bb, [A, B], speed, 'move');
                        } catch(e){}
                    } else if (mode === 'rotate') {
                        // create platform that will be rotated in-place by movingPlatformsUpdate with mode='rotate'
                        try {
                            this.game.levelManager.createMovingPlatform(meta.mesh.position.x, meta.mesh.position.y, meta.mesh.position.z, meta.mesh.scale.x || 3.2, meta.mesh.scale.y || 0.6, meta.mesh.scale.z || 3.2, meta.data.color || 0x8899bb, [meta.mesh.position.clone(), meta.mesh.position.clone()], speed, 'rotate');
                        } catch(e){}
                    }
                    // hide editor visuals (markers and line) but keep metadata if needed
                    try {
                        if (meta.markerA) meta.markerA.visible = false;
                        if (meta.markerB) meta.markerB.visible = false;
                        if (meta.line) meta.line.visible = false;
                        // remove editor platform visual
                        try { this.game.scene.remove(meta.mesh); } catch(e){}
                    } catch(e){}
                } else if (p.type === 'spinning' && p.data && p.data.spawn) {
                    const pos = p.data.spawn;
                    const p0 = new THREE.Vector3(pos[0], pos[1], pos[2]);
                    try {
                        this.game.levelManager.createMovingPlatform(p0.x, p0.y, p0.z, 3.2, 0.6, 3.2, 0x8899bb, [p0, p0], 0.12, 'rotate');
                    } catch(e){}
                    try { this.game.scene.remove(p.mesh); } catch(e){}
                } else if (p.type === 'deco' && p.data && p.data.spawn) {
                    const s = p.data.spawn;
                    try {
                        const col = new THREE.Color().setHSL(Math.random(), 0.7, 0.6).getHex();
                        const mat = this.game.sceneRenderer.createBallMaterial({ color: col, shininess: 0.6, textureType: 'noise', textureAlpha: 0.4 });
                        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), mat);
                        mesh.position.set(s[0], s[1], s[2]);
                        mesh.castShadow = true;
                        this.game.scene.add(mesh);
                    } catch(e){}
                    try { this.game.scene.remove(p.mesh); } catch(e){}
                }
            } catch(e){}
        }

        // Hide editor UI and fully exit editor mode
        this.toggle(false);
        // ensure editor internal active flag cleared
        this.active = false;
    }

    importLevel() {
        const blob = prompt("Paste Level Data:");
        if (!blob) return;
        try {
            const data = JSON.parse(blob);
            this.game.levelManager.clearLevel();
            this.customParts = [];
            data.forEach(d => {
                let mesh;
                if (d.type === 'platform') {
                    // preserve dimensions by using scale.x as width etc.
                    const w = (d.scale && d.scale[0]) ? d.scale[0] : 4;
                    const h = (d.scale && d.scale[1]) ? d.scale[1] : 1;
                    const z = (d.scale && d.scale[2]) ? d.scale[2] : 4;
                    mesh = this.game.levelManager.createPlatform(d.pos[0], d.pos[1], d.pos[2], w, h, z, d.color);
                } else if (d.type === 'moving') {
                    const w = (d.scale && d.scale[0]) ? d.scale[0] : 4;
                    const h = (d.scale && d.scale[1]) ? d.scale[1] : 1;
                    const z = (d.scale && d.scale[2]) ? d.scale[2] : 4;
                    const p0 = new THREE.Vector3(d.pos[0], d.pos[1], d.pos[2]);
                    const p1 = (d.spawn && d.spawn.length === 3) ? new THREE.Vector3(d.spawn[0], d.spawn[1], d.spawn[2]) : p0.clone().add(new THREE.Vector3(0,5,0));
                    mesh = this.game.levelManager.createMovingPlatform(d.pos[0], d.pos[1], d.pos[2], w, h, z, d.color, [p0, p1]);
                } else if (d.type === 'jump') {
                    mesh = this.game.levelManager.createJumpPad(d.pos[0], d.pos[1], d.pos[2]);
                } else if (d.type === 'ball') {
                    // place gameplay spawn location by creating the ball
                    this.game.levelManager.createBall(d.pos[0], d.pos[1], d.pos[2]);
                    mesh = this.game.levelManager.ball;
                } else if (d.type === 'checkpoint') {
                    mesh = this.game.levelManager.createCheckpoint(d.pos[0], d.pos[1], d.pos[2]);
                } else if (d.type === 'win') {
                    this.game.levelManager.createWinArea(d.pos[0], d.pos[1], d.pos[2]);
                    mesh = this.game.levelManager.winArea;
                }

                if (mesh) {
                    try { mesh.position.fromArray(d.pos); } catch(e){}
                    try { if (mesh.scale && d.scale) mesh.scale.fromArray(d.scale); } catch(e){}
                    try { if (mesh.rotation && d.rot) mesh.rotation.fromArray(d.rot); } catch(e){}
                    mesh.userData.isCustom = true;
                    this.customParts.push({ mesh, type: d.type, data: d });
                }
            });
        } catch(e) { alert("Invalid data"); }
    }
}

