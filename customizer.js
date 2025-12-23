import * as THREE from 'three';
import { SceneRenderer } from './renderer.js';

export class MarbleCustomizer {
    constructor(game) {
        this.game = game;
        this.overlay = document.getElementById('customizer-overlay');
        this.previewContainer = document.getElementById('preview-canvas-container');
        
        this.settings = JSON.parse(localStorage.getItem('marbleSettings')) || {
            color: '#ffffff',
            shininess: 0.5,
            textureType: 'noise',
            textureAlpha: 0.3
        };

        // Keep an initial snapshot so "Reset" restores to the state when customizer was opened
        this.initialSettings = JSON.parse(JSON.stringify(this.settings));

        this.initPreview();
        this.initUI();
    }

    initPreview() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);
        
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        // Pull camera back a bit to show the marble at a 1:1 visual scale with the small preview sphere
        this.camera.position.set(0, 0, 2.5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.previewContainer.appendChild(this.renderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(2, 2, 2);
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        
        // Resize handler to force a square (1:1) preview canvas so the marble viewer is not stretched
        this.resizePreview = () => {
            if (!this.previewContainer || !this.overlay || this.overlay.style.display === 'none') return;
            // Pick the smaller of width/height to keep a 1:1 square canvas that fits the container
            const w = this.previewContainer.clientWidth || 200;
            const h = this.previewContainer.clientHeight || 200;
            const size = Math.max(128, Math.min(w, h)); // keep a sensible minimum
            this.camera.aspect = 1; // square aspect
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(size, size, false);
            // center canvas visually in the preview container
            const canvas = this.renderer.domElement;
            canvas.style.width = `${size}px`;
            canvas.style.height = `${size}px`;
            canvas.style.maxWidth = '100%';
            canvas.style.height = 'auto';
            // ensure container aligns the square canvas centered
            this.previewContainer.style.display = 'flex';
            this.previewContainer.style.alignItems = 'center';
            this.previewContainer.style.justifyContent = 'center';
        };
        window.addEventListener('resize', this.resizePreview);

        this.sceneRenderer = new SceneRenderer(this.scene);
        
        // Use the same visual radius as the in-game marble (0.5) so the preview represents the real scale
        this.ballGeo = new THREE.SphereGeometry(0.5, 64, 64);
        this.ball = new THREE.Mesh(this.ballGeo, this.sceneRenderer.createBallMaterial(this.settings));
        this.scene.add(this.ball);

        this.isRotating = false;
        this.lastX = 0;

        const onMove = (x) => {
            if (this.isRotating) {
                const dx = x - this.lastX;
                this.ball.rotation.y += dx * 0.01;
                this.lastX = x;
            }
        };

        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this.isRotating = true;
            this.lastX = e.clientX;
        });
        window.addEventListener('pointermove', (e) => onMove(e.clientX));
        window.addEventListener('pointerup', () => this.isRotating = false);

        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.overlay.style.display === 'flex') {
            this.renderer.render(this.scene, this.camera);
        }
    }

    initUI() {
        const colorGrid = document.getElementById('color-grid');
        for (let i = 0; i < 32; i++) {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            const color = new THREE.Color().setHSL(i / 32, 0.8, 0.6);
            const hex = '#' + color.getHexString();
            swatch.style.backgroundColor = hex;
            if (hex === this.settings.color) swatch.classList.add('active');
            swatch.onclick = () => {
                this.settings.color = hex;
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                this.updatePreview();
            };
            colorGrid.appendChild(swatch);
        }

        const texBtns = document.querySelectorAll('.tex-btn');
        texBtns.forEach(btn => {
            if (btn.dataset.tex === this.settings.textureType) btn.classList.add('active');
            btn.onclick = () => {
                this.settings.textureType = btn.dataset.tex;
                texBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updatePreview();
            };
        });

        const shinySlider = document.getElementById('cust-shiny');
        shinySlider.value = this.settings.shininess;
        shinySlider.oninput = (e) => {
            this.settings.shininess = parseFloat(e.target.value);
            this.updatePreview();
        };

        const alphaSlider = document.getElementById('cust-alpha');
        alphaSlider.value = this.settings.textureAlpha;
        alphaSlider.oninput = (e) => {
            this.settings.textureAlpha = parseFloat(e.target.value);
            this.updatePreview();
        };

        // Helper to sync UI from current settings (useful after reset)
        this.syncUIFromSettings = () => {
            // Colors
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            const swatches = Array.from(document.querySelectorAll('.color-swatch'));
            const match = swatches.find(s => s.style.backgroundColor && this._normalizeHex(s.style.backgroundColor) === this._normalizeHex(this.settings.color));
            if (match) match.classList.add('active');

            // Textures
            texBtns.forEach(b => b.classList.remove('active'));
            const activeTex = Array.from(texBtns).find(b => b.dataset.tex === this.settings.textureType);
            if (activeTex) activeTex.classList.add('active');

            // Sliders
            shinySlider.value = this.settings.shininess;
            alphaSlider.value = this.settings.textureAlpha;

            // Update preview material
            this.updatePreview();
        };

        // Reset button restores to initialSettings snapshot (the values present when the customizer was opened)
        const resetBtn = document.getElementById('reset-custom-btn');
        if (resetBtn) {
            resetBtn.onclick = (e) => {
                e.preventDefault();
                // Delegate to the correct reset handler depending on origin
                if (this.origin === 'menu') {
                    this.MainMenuResetCustomizer();
                } else {
                    this.NormalResetCustomizer();
                }
                // Update preview to reflect the reset
                this.updatePreview();
            };
        }

        const saveBtn = document.getElementById('save-custom-btn');
        if (saveBtn) {
            saveBtn.onclick = (e) => {
                e.preventDefault();
                if (this.origin === 'menu') {
                    this.MainMenuSaveCustomizer();
                    // restore main menu overlay visibility explicitly (demo remains running)
                    try { if (this.game.menuEl) this.game.menuEl.style.display = 'flex'; this.game.menuVisible = true; } catch (err) {}
                } else {
                    this.NormalSaveCustomizer();
                }
            };
        }

        const closeBtn = document.getElementById('close-custom-btn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.preventDefault();
                if (this.origin === 'menu') {
                    // returning to main menu: ensure main menu is visible
                    try { if (this.game.menuEl) this.game.menuEl.style.display = 'flex'; this.game.menuVisible = true; } catch (err) {}
                    this.close();
                } else {
                    // closing while opened from pause should keep the game paused and re-open the pause overlay
                    this.NormalCancelCustomizer();
                }
            };
        }

        // main-menu entry point: find any main-menu button and hook it to open with origin 'menu'
        const mainMenuOpenBtn = document.getElementById('main-settings-open-customizer');
        if (mainMenuOpenBtn) {
            mainMenuOpenBtn.onclick = (e) => {
                e.preventDefault();
                this.MainMenuOpenCustomizer();
            };
        }
        // Preserve and normalize hook for pause-overlay -> open customizer (keeps origin 'pause')
        const pauseOpenBtn = document.getElementById('open-customizer-btn');
        if (pauseOpenBtn) pauseOpenBtn.onclick = () => this.NormalOpenCustomizer();
    }

    // Utility: normalize rgb(...) or hex to hex string for comparison
    _normalizeHex(cssColor) {
        // If already hex
        if (!cssColor) return '';
        cssColor = cssColor.trim();
        if (cssColor[0] === '#') return cssColor.toLowerCase();
        // rgb(a)
        const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const r = parseInt(m[1]).toString(16).padStart(2, '0');
            const g = parseInt(m[2]).toString(16).padStart(2, '0');
            const b = parseInt(m[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return cssColor.toLowerCase();
    }

    updatePreview() {
        this.ball.material.dispose();
        this.ball.material = this.sceneRenderer.createBallMaterial(this.settings);
    }

    // ----- Named handlers for external callers (Normal* = in-game/pause flow, MainMenu* = main menu flow) -----
    NormalOpenCustomizer() {
        // open from pause/menu in gameplay context: origin 'pause' means gameplay was paused
        this.open('pause');
    }

    NormalCancelCustomizer() {
        // Cancel while opened from pause: close and restore pause overlay + keep gameplay paused
        this.close(); // close will handle restoring pause overlay when origin==='pause'
    }

    NormalResetCustomizer() {
        // Reset while in gameplay/pause context: clear saved settings and reload current level to apply
        localStorage.removeItem('marbleSettings');
        // reload current level to apply cleared settings if a level exists
        try {
            if (this.game && this.game.levelManager) {
                const idx = this.game.levelManager.currentLevelIndex || 0;
                this.game.levelManager.loadLevel(idx);
            }
        } catch (e) {}
        // update preview to reflect reset state
        this.settings = {
            color: '#ffffff',
            shininess: 0.5,
            textureType: 'noise',
            textureAlpha: 0.3
        };
        this.syncUIFromSettings && this.syncUIFromSettings();
    }

    NormalSaveCustomizer() {
        // Save settings, apply to current level, close and keep game paused state as appropriate
        localStorage.setItem('marbleSettings', JSON.stringify(this.settings));
        // If customizing during gameplay, reload level to apply changes
        try {
            if (this.origin !== 'menu' && this.game && this.game.levelManager) {
                this.game.levelManager.loadLevel(this.game.levelManager.currentLevelIndex);
            }
        } catch (e) {}
        this.close();
    }

    MainMenuOpenCustomizer() {
        // Open customizer from main menu demo context (origin 'menu'), keep demo running
        this.open('menu');
    }

    MainMenuResetCustomizer() {
        // Reset from the main menu: clear saved settings but do not force a level reload (demo should keep running)
        localStorage.removeItem('marbleSettings');
        this.settings = {
            color: '#ffffff',
            shininess: 0.5,
            textureType: 'noise',
            textureAlpha: 0.3
        };
        this.syncUIFromSettings && this.syncUIFromSettings();
    }

    MainMenuSaveCustomizer() {
        // Save and close when opened from main menu; do not reload level
        localStorage.setItem('marbleSettings', JSON.stringify(this.settings));
        this.close();
    }

    open(origin = 'menu') {
        // Record where the customizer was opened from so save/close behaviors are correct
        this.origin = origin;

        // Sync internal settings with whatever the ball currently is (random or saved) only if present.
        // Do not trigger any level loads by querying the level manager.
        try {
            if (this.game && this.game.levelManager && this.game.levelManager.currentBallParams) {
                this.settings = JSON.parse(JSON.stringify(this.game.levelManager.currentBallParams));
                if (this.syncUIFromSettings) this.syncUIFromSettings();
            }
        } catch (e) {
            // swallow any errors to avoid interrupting UI
        }

        // Snapshot the current settings as "initial" so Reset returns here
        this.initialSettings = JSON.parse(JSON.stringify(this.settings));

        // Show the overlay
        this.overlay.style.display = 'flex';

        // Only disable gameplay controls when the customizer was opened from the pause menu.
        // When opened from the main menu we want the demo to keep running (do not disable controls).
        if (this.origin === 'pause') {
            try { this.game.controls.enabled = false; } catch (e) {}
        }

        // Trigger resize for preview canvas after layout
        setTimeout(() => {
            if (this.resizePreview) this.resizePreview();
        }, 30);
    }

    close() {
        this.overlay.style.display = 'none';
        // Restore control and UI state based on where the customizer was opened from
        try {
            if (this.origin === 'pause') {
                // Keep gameplay paused and show pause overlay; controls should remain disabled
                if (this.game) {
                    try { this.game.controls.enabled = false; } catch (e) {}
                    const pauseOverlay = document.getElementById('menu-overlay');
                    if (pauseOverlay) pauseOverlay.style.display = 'flex';
                }
            } else if (this.origin === 'menu') {
                // If opened from main menu, keep demo running and ensure controls remain disabled for menu
                if (this.game) {
                    try { this.game.controls.enabled = false; } catch (e) {}
                    if (this.game.menuEl) this.game.menuEl.style.display = 'flex';
                    this.game.menuVisible = true;
                }
            } else {
                // default: re-enable controls for normal gameplay contexts
                try { if (this.game) this.game.controls.enabled = true; } catch (e) {}
            }
        } catch (e) {
            // fallback to enabling controls to avoid lockout in edge cases
            try { if (this.game) this.game.controls.enabled = true; } catch (err) {}
        }
    }
}

