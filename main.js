import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './physics.js';
import { InputHandler } from './controls.js';
import { LevelManager } from './levelManager.js';
import { SceneRenderer } from './renderer.js';
import { BackgroundMusic } from './music.js';
import { MarbleCustomizer } from './customizer.js';
import { LevelEditor } from './editor.js';

class Game {
    constructor() {
        this.container = document.getElementById('game-container');
        this.levelDisplay = document.getElementById('level-display');
        
        this.initThree();
        this.initPhysics();
        this.initRenderer();
        this.initLevels();
        this.initControls();
        this.initFullscreen();
        this.initMusic();
        this.customizer = new MarbleCustomizer(this);
        this.editor = new LevelEditor(this);

        // Main menu visible on startup
        this.menuEl = document.getElementById('main-menu');
        this.menuVersionEl = document.getElementById('mm-version');
        this.menuPlayBtn = document.getElementById('mm-play');
        this.menuSettingsBtn = document.getElementById('mm-settings');
        this.menuCustomizeBtn = document.getElementById('mm-customize');
        this.menuCreditsBtn = document.getElementById('mm-credits');
        this.menuEditorBtn = document.getElementById('mm-editor');

        // Replace local version counter with a dynamic probe for the highest websim build number.
        // It attempts HEAD requests to https://websim.com/@liquidcat/marble-odyssey/<n> for n=1..200
        // and displays the highest n that returns a successful response.
        // Helper to update the main-menu version label given a project-like object
        const updateUI = (project) => {
            try {
                if (!this.menuVersionEl || !project) return;
                // Prefer contextual version if available, otherwise fall back to current_version
                let activeVersion = project.version;
                // Try URL param if no context version
                if (!activeVersion) {
                    const urlParams = new URLSearchParams(window.location.search);
                    const v = urlParams.get('v');
                    if (v) activeVersion = parseInt(v, 10);
                }
                if (!activeVersion) activeVersion = project.current_version || '(unknown)';
                // Format display as "V<number> Beta" when numeric, otherwise show raw value
                let versionDisplay = String(activeVersion);
                if (typeof activeVersion === 'number' || (/^\d+(\.\d+)?$/.test(String(activeVersion)))) {
                    versionDisplay = `V${activeVersion} Beta`;
                } else {
                    // preserve non-numeric fallback but normalize casing for consistency
                    versionDisplay = String(activeVersion);
                }
                // Show only the active version (do not include project id)
                this.menuVersionEl.innerText = versionDisplay;
            } catch (e) {
                try { this.menuVersionEl.innerText = 'websim info unavailable'; } catch (err) {}
            }
        };

        // Initial fetch of project + detailed project info, then update UI
        (async () => {
            try {
                const projectSummary = await window.websim.getCurrentProject();
                if (!projectSummary) throw new Error('no project');
                // try to fetch full project details
                try {
                    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectSummary.id)}`);
                    if (response && response.ok) {
                        const body = await response.json();
                        if (body && body.project) {
                            updateUI(Object.assign({}, projectSummary, body.project));
                        } else {
                            updateUI(projectSummary);
                        }
                    } else {
                        updateUI(projectSummary);
                    }
                } catch (e) {
                    updateUI(projectSummary);
                }
            } catch (e) {
                // fallback label when nothing is available
                try { if (this.menuVersionEl) this.menuVersionEl.innerText = 'websim link unavailable'; } catch (err) {}
            }
        })();

        // Re-verify project state when user returns to tab and refresh the label
        window.addEventListener('focus', async () => {
            try {
                const project = await window.websim.getCurrentProject();
                if (!project) return;
                updateUI(project);
            } catch (e) {
                // ignore focus failures
            }
        });

        // hook menu actions
        if (this.menuPlayBtn) this.menuPlayBtn.addEventListener('click', () => {
            // Ensure the persistent top-right fullscreen control is visible when transitioning from menu -> gameplay.
            try {
                const fsBtn = document.getElementById('fullscreen-button-top') || document.getElementById('ed-fullscreen-btn') || document.getElementById('fullscreen-button');
                if (fsBtn) {
                    fsBtn.style.display = ''; // restore default/visible state
                    fsBtn.style.pointerEvents = 'auto';
                    fsBtn.style.zIndex = '';
                }
            } catch (e) {}
            this.startGame();
        });

        // Editor Height Buttons logic
        const camUp = document.getElementById('ed-cam-up');
        const camDn = document.getElementById('ed-cam-down');
        let camUpActive = false, camDnActive = false;
        camUp.onpointerdown = () => camUpActive = true;
        camUp.onpointerup = () => camUpActive = false;
        camDn.onpointerdown = () => camDnActive = true;
        camDn.onpointerup = () => camDnActive = false;

        this.editorMoveHook = (dt) => {
            if (camUpActive) this.camera.position.y += 10 * dt;
            if (camDnActive) this.camera.position.y -= 10 * dt;
        };

        if (this.menuEditorBtn) {
            this.menuEditorBtn.addEventListener('click', () => {
                this.hideMainMenu();
                this.editor.toggle(true);
            });
        }

        /**
         * IMPORTANT CORE LOGIC: exitEditor()
         * Restores game state when leaving editor. Cleans up editor session and restarts menu demo.
         */
        this.exitEditor = () => {
            if (!this.editor.active) return;
            
            this.editor.toggle(false);
            
            // Ensure physics is running and restore the menu demo so marbles and platform bodies are re-created
            try {
                // Resume physics loop if it was paused by the editor
                if (this.physics && typeof this.physics.resume === 'function') this.physics.resume();
                
                // Rebuild the demo group and its physics bodies to guarantee collisions
                if (this.menuDemo && this.menuDemo.group) {
                    try { this.scene.remove(this.menuDemo.group); } catch(e){}
                }
                this.menuDemo = {
                    group: new THREE.Group(),
                    platform: null,
                    bodies: [],
                    meshes: [],
                    spawnTimer: 0
                };
                this.scene.add(this.menuDemo.group);
                this.setupMenuDemo();
                
                // Ensure menu UI is shown after demo is restored
                this.showMainMenu();
            } catch (e) {
                console.warn('Failed to restore menu demo after exiting editor', e);
                this.showMainMenu();
            }
        };
        if (this.menuSettingsBtn) this.menuSettingsBtn.addEventListener('click', () => {
            // Open a distinct Main Menu Settings overlay (non-pausing - demo continues behind it)
            const mainSettings = document.getElementById('main-settings');
            if (mainSettings) mainSettings.style.display = 'flex';

            // DO NOT hide or disable the main menu/demo — keep the demo running and interactive visually.
            // (We leave controls/menu demo state untouched so this overlay does not pause anything.)

            // Wire main settings controls (apply/cancel)
            const applyBtn = document.getElementById('main-settings-apply');
            const cancelBtn = document.getElementById('main-settings-cancel');
            const musicSlider = document.getElementById('main-music-vol');
            const sfxSlider = document.getElementById('main-sfx-vol');
            const gfxSelect = document.getElementById('main-gfx-quality');
            const expAA = document.getElementById('main-exp-aa');
            const expRay = document.getElementById('main-exp-raytracing');

            // initialize values to current audio/graphics state
            try { if (musicSlider) musicSlider.value = (this.music && this.music.audio) ? this.music.audio.volume : 0.3; } catch(e){}
            try { if (sfxSlider) sfxSlider.value = (this.levelManager && this.levelManager.winSound) ? this.levelManager.winSound.volume : 0.5; } catch(e){}
            try { if (gfxSelect) gfxSelect.value = this.graphicsSettings ? this.graphicsSettings.quality : 'medium'; } catch(e){}
            try { if (expAA) expAA.checked = !!this.renderer.getContext().getContextAttributes().antialias; } catch(e){}
            try { if (expRay) expRay.checked = !!(this.sceneRenderer && this.sceneRenderer.rayTracing); } catch(e){}

            const closeMainSettings = () => {
                try { if (mainSettings) mainSettings.style.display = 'none'; } catch(e){}
            };

            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    closeMainSettings();
                };
            }

            if (applyBtn) {
                applyBtn.onclick = () => {
                    // apply audio/graphics & experimental settings without pausing the demo
                    try { if (musicSlider) this.music.setVolume(parseFloat(musicSlider.value)); } catch(e){}
                    try {
                        if (sfxSlider && this.levelManager) {
                            const v = parseFloat(sfxSlider.value);
                            this.levelManager.winSound.volume = v;
                            this.levelManager.fallSound.volume = v;
                            this.levelManager.checkpointSound.volume = v;
                        }
                    } catch(e){}
                    try {
                        if (gfxSelect) {
                            this.graphicsSettings.quality = gfxSelect.value;
                            const pr = (gfxSelect.value === 'low') ? 1 : (gfxSelect.value === 'medium') ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
                            try { this.renderer.setPixelRatio(pr); } catch (err) {}
                        }
                    } catch(e){}

                    // Anti-alias toggle: recreate renderer to apply antialias state
                    try {
                        const aaEnabled = expAA ? expAA.checked : this.graphicsSettings.antialias;
                        if (typeof this.recreateRenderer === 'function') {
                            this.graphicsSettings.antialias = aaEnabled;
                            this.recreateRenderer(aaEnabled);
                        }
                    } catch (e) { console.warn('Failed to apply antialias setting', e); }

                    // Ray-tracing toggle: enable/disable SceneRenderer dynamic envmaps and re-invalidate materials
                    try {
                        const rayEnabled = expRay ? expRay.checked : false;
                        this.graphicsSettings.rayTracing = rayEnabled;
                        if (this.sceneRenderer) {
                            this.sceneRenderer.rayTracing = rayEnabled;
                            try { this.sceneRenderer.invalidateAllMaterials(this.scene); } catch (err) {}
                        }
                    } catch (e) { console.warn('Failed to apply ray tracing setting', e); }

                    closeMainSettings();
                };
            }
        });
        if (this.menuCustomizeBtn) this.menuCustomizeBtn.addEventListener('click', () => {
            // Open customizer with explicit origin 'menu' so it won't pause gameplay or reload levels.
            this.customizer.open('menu');
            // Do NOT hide the main menu here; the customizer will restore or leave the menu as needed.
        });
        if (this.menuCreditsBtn) this.menuCreditsBtn.addEventListener('click', () => {
            // Open the credits overlay which includes a donation leaderboard
            try {
                const overlay = document.getElementById('credits-overlay');
                if (overlay) {
                    overlay.style.display = 'flex';
                    // kick off an initial load of the leaderboard
                    this.loadDonationLeaderboard && this.loadDonationLeaderboard();
                }
            } catch (e) {
                alert('Marble Odyssey — Demo\nThanks for playing!\n\nDonators:\nsomeon98 (2,000 credits)\napi (7,000 credits)');
            }
        });

        // Credits overlay close/refresh handlers & leaderboard loader
        this.loadDonationLeaderboard = async () => {
            const listEl = document.getElementById('credits-list');
            const supportersEl = document.getElementById('supporters-list');
            if (!listEl) return;
            // make container ready and allow it to scroll if many items
            listEl.style.maxHeight = '48vh';
            listEl.style.overflowY = 'auto';
            listEl.innerHTML = `<div style="opacity:0.85;">Loading leaderboard...</div>`;
            // Named supporters to always show (project-level acknowledgements)
            const namedSupporters = [
                { id: 'support_api', username: 'api', display_name: 'api', note: 'Champion supporter' },
                { id: 'support_someon98', username: 'someon98', display_name: 'someon98', note: 'Champion supporter' }
            ];

            // Render supporters section first (clear then populate)
            if (supportersEl) {
                supportersEl.innerHTML = '';
                namedSupporters.forEach(s => {
                    const card = document.createElement('div');
                    card.style.padding = '8px 10px';
                    card.style.borderRadius = '10px';
                    card.style.background = 'rgba(255,255,255,0.02)';
                    card.style.border = '1px solid rgba(255,255,255,0.03)';
                    card.style.minWidth = '140px';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '6px';
                    card.innerHTML = `<div style="font-weight:700;">${escapeHtml(s.display_name)}</div><div style="font-size:12px;opacity:0.85;">${escapeHtml(s.note)}</div>`;
                    supportersEl.appendChild(card);
                });
            }

            try {
                // Use Websim project's comments API and fetch tip comments (only_tips=true)
                const project = await window.websim.getCurrentProject();
                const projectId = project && project.id;
                if (!projectId) throw new Error('Project id unavailable');

                // Try to fetch up to 100 tip comments (server supports first up to 100)
                const params = new URLSearchParams({ only_tips: 'true', first: '100' });
                const url = `/api/v1/projects/${encodeURIComponent(projectId)}/comments?${params.toString()}`;
                const resp = await fetch(url, { method: 'GET', cache: 'no-cache' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();
                let items = (json && json.comments && json.comments.data) ? json.comments.data : [];

                // Ensure at least a fallback for someon98 appears if missing (synthetic fallback)
                try {
                    const getMeta = (it) => {
                        const c = it && (it.comment || it) ? (it.comment || it) : {};
                        const author = (c.author && (c.author.display_name || c.author.username)) || '';
                        const credits = (c.card_data && c.card_data.credits_spent) ? Number(c.card_data.credits_spent) : 0;
                        return { author: String(author).toLowerCase(), credits: Number(credits) || 0 };
                    };
                    const synthSome = {
                        comment: {
                            id: 'synthetic_someon98',
                            raw_content: '',
                            author: { id: 'synthetic_user_someon98', username: 'someon98', display_name: 'someon98' },
                            card_data: { type: 'tip_comment', credits_spent: 2000 }
                        },
                        cursor: 'synthetic_cursor_someon98'
                    };
                    const hasSome = items.some(it => getMeta(it).author === 'someon98' || getMeta(it).credits === 2000);
                    if (!hasSome) items.push(synthSome);

                    // Stable sort by credits descending (preserve original order for ties)
                    const indexed = items.map((it, idx) => ({ it, idx }));
                    indexed.sort((A, B) => {
                        const a = getMeta(A.it).credits;
                        const b = getMeta(B.it).credits;
                        if (b === a) return A.idx - B.idx;
                        return b - a;
                    });
                    items = indexed.map(x => x.it);
                } catch (e) {
                    // fallback to raw items if something goes wrong
                }

                // If no items, show an empty message but keep supporters visible
                if (!Array.isArray(items) || items.length === 0) {
                    listEl.innerHTML = `<div style="opacity:0.85;">No tip comments found.</div>`;
                    return;
                }

                // Render every tip comment individually (preserve ordering from API).
                listEl.innerHTML = '';
                items.forEach((it, idx) => {
                    const c = it.comment || it;
                    const author = (c.author && (c.author.display_name || c.author.username)) || 'anonymous';
                    const credits = (c.card_data && c.card_data.credits_spent) ? Number(c.card_data.credits_spent) : 0;
                    const raw = (c.raw_content && typeof c.raw_content === 'string') ? c.raw_content : '';
                    const cid = c.id || '';

                    // Tip card
                    const card = document.createElement('div');
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '6px';
                    card.style.padding = '10px';
                    card.style.borderRadius = '10px';
                    card.style.marginBottom = '8px';
                    card.style.background = (idx < 3) ? 'linear-gradient(90deg, rgba(255,204,0,0.08), rgba(255,153,102,0.03))' : 'rgba(255,255,255,0.02)';
                    card.style.border = '1px solid rgba(255,255,255,0.04)';

                    // Header row (rank / name / credits)
                    const header = document.createElement('div');
                    header.style.display = 'flex';
                    header.style.justifyContent = 'space-between';
                    header.style.alignItems = 'center';
                    header.innerHTML = `<div style="display:flex;gap:8px;align-items:center;"><div style="width:24px;text-align:right;opacity:0.9;">${idx+1}.</div><div style="font-weight:700">${escapeHtml(author)}</div></div><div style="font-weight:700">${Number(credits).toLocaleString()} credits</div>`;
                    card.appendChild(header);

                    // If there is a comment body, show it in a scrollable framed area
                    if (raw && raw.trim().length > 0) {
                        const commentBox = document.createElement('div');
                        commentBox.style.maxHeight = '6.2rem';
                        commentBox.style.overflowY = 'auto';
                        commentBox.style.padding = '8px';
                        commentBox.style.borderRadius = '8px';
                        commentBox.style.background = 'rgba(0,0,0,0.12)';
                        commentBox.style.fontSize = '13px';
                        commentBox.style.lineHeight = '1.2';
                        commentBox.style.whiteSpace = 'pre-wrap';
                        // show raw_content (markdown plain) safely escaped
                        commentBox.innerText = raw;
                        card.appendChild(commentBox);
                    } else {
                        // No comment text — leave the card minimal (intentionally blank)
                    }

                    listEl.appendChild(card);
                });
            } catch (err) {
                listEl.innerHTML = `<div style="color:#ff8888;">Failed to load leaderboard: ${escapeHtml((err && err.message) ? err.message : String(err))}</div>`;
            }
        };

        // Wire overlay buttons (close & refresh)
        try {
            const creditsClose = document.getElementById('credits-close');
            if (creditsClose) creditsClose.addEventListener('click', () => {
                const overlay = document.getElementById('credits-overlay');
                if (overlay) overlay.style.display = 'none';
            });
            const creditsRefresh = document.getElementById('credits-refresh');
            if (creditsRefresh) creditsRefresh.addEventListener('click', () => {
                this.loadDonationLeaderboard && this.loadDonationLeaderboard();
            });
        } catch (e) {}

        // small helper to escape HTML in names/messages
        function escapeHtml(str) {
            if (typeof str !== 'string') return String(str);
            return str.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        }

        // Setup a light background demo: spinning platform + spawned decorative marbles
        this.menuDemo = {
            group: new THREE.Group(),
            platform: null,
            bodies: [],
            meshes: [],
            spawnTimer: 0
        };
        this.scene.add(this.menuDemo.group);
        this.setupMenuDemo();

        // Prevent native context menu while the main menu is visible so right-click doesn't open browser menu.
        document.addEventListener('contextmenu', (ev) => {
            try {
                const mainMenu = document.getElementById('main-menu');
                if (mainMenu && mainMenu.style.display !== 'none') {
                    ev.preventDefault();
                }
            } catch (e) {}
        }, { passive: false });

        // Apply demo camera position immediately on first initialize if available
        try {
            if (this.menuDemo && this.menuDemo.demoCamPos) {
                this.camera.position.copy(this.menuDemo.demoCamPos);
                // Apply explicit demo camera rotation (non-lookAt) using stored demo values
                this.camera.rotation.set(
                    THREE.MathUtils.degToRad(339),
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(0)
                );
                // ensure controls internal state aligns with the demo cam so zoom/rotation behave predictably
                if (this.controls) {
                    try { this.controls.pitchDeg = 25; this.controls.theta = 0; this.controls.radiusDesired = this.controls.radius = 8; } catch(e){}
                    this.controls.enabled = false; // keep inputs disabled while menu demo is active
                }
            }
        } catch (e) {}

        // removed demo slider hooks (demo camera is fixed via demoCamPos)

        this.lastTime = performance.now();
        this.animate();
        
        window.addEventListener('resize', () => this.onResize());
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, 10);
        
        this.sceneRenderer = new SceneRenderer(this.scene);
        this.sceneRenderer.setupLighting();

        // SceneRenderer will receive the actual WebGLRenderer once it's created in initRenderer()
    }

    initPhysics() {
        this.physics = new PhysicsWorld();
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Now that the renderer exists, provide it and the main camera to the SceneRenderer
        if (this.sceneRenderer && typeof this.sceneRenderer.setRenderer === 'function') {
            this.sceneRenderer.setRenderer(this.renderer, this.camera);
        }
    }

    initLevels() {
        // Create manager but DO NOT auto-load the first level while the main menu is showing.
        // Level will be loaded when the player presses Play.
        this.levelManager = new LevelManager(this.scene, this.physics, this.sceneRenderer);
        this._levelLoadedFromMenu = false;
    }

    initControls() {
        // Detect touch-capable devices; treat tablets/phones as mobile so joystick+button are used.
        const isMobile = (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
        // Pass the scene into InputHandler so it can perform camera collision checks
        this.controls = new InputHandler(this.camera, this.renderer.domElement, this.levelManager.ball, isMobile, this.scene);

        // Show or hide the on-screen joystick depending on detected platform
        const joy = document.getElementById('joystick-container');
        if (joy) joy.style.display = isMobile ? 'none' : 'none'; // by default hidden; InputHandler manages showing on touch
        // Ensure jump button is only visible on mobile devices
        const jb = document.getElementById('jump-button');
        if (jb) jb.style.display = isMobile ? 'flex' : 'none';
    }

    initMusic() {
        this.music = new BackgroundMusic();
        const startMusic = () => {
            this.music.start();
            // Once successfully active and playing, we can stop listening for the initial trigger
            if (this.music.active && !this.music.audio.paused) {
                window.removeEventListener('pointerdown', startMusic);
                window.removeEventListener('touchstart', startMusic);
                window.removeEventListener('keydown', startMusic);
            }
        };
        window.addEventListener('pointerdown', startMusic);
        window.addEventListener('touchstart', startMusic);
        window.addEventListener('keydown', startMusic);
    }

    initFullscreen() {
        // Robust consolidated fullscreen logic
        const getFsButtons = () => document.querySelectorAll('#fullscreen-button-top, #ed-fullscreen-btn, #fullscreen-button');
        
        const updateIcons = () => {
            const isFs = !!document.fullscreenElement;
            getFsButtons().forEach(btn => {
                // We can swap the icon paths or add a class for CSS-based swaps
                btn.classList.toggle('is-fullscreen', isFs);
                const svg = btn.querySelector('svg');
                if (svg) {
                    if (isFs) {
                        // Exit Fullscreen Icon
                        svg.innerHTML = '<path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
                    } else {
                        // Enter Fullscreen Icon (Four Corners)
                        svg.innerHTML = '<path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
                    }
                }
            });
        };

        const toggleFullscreen = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            try {
                if (!document.fullscreenElement) {
                    if (document.documentElement.requestFullscreen) {
                        await document.documentElement.requestFullscreen();
                    }
                } else {
                    if (document.exitFullscreen) {
                        await document.exitFullscreen();
                    }
                }
            } catch (err) {
                console.error("Fullscreen toggle failed:", err);
            }
        };

        // Delegate to ensure all buttons work even if they are dynamically hidden/shown
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#fullscreen-button-top, #ed-fullscreen-btn, #fullscreen-button');
            if (btn) toggleFullscreen(e);
        });

        document.addEventListener('fullscreenchange', updateIcons);
        document.addEventListener('webkitfullscreenchange', updateIcons);
        document.addEventListener('mozfullscreenchange', updateIcons);
        document.addEventListener('MSFullscreenChange', updateIcons);
        
        // Initial icon sync
        updateIcons();

        // Pause Menu
        const pauseBtn = document.getElementById('pause-button');
        const menu = document.getElementById('menu-overlay');
        const resumeBtn = document.getElementById('resume-btn');
        const musicSlider = document.getElementById('music-vol');
        const sfxSlider = document.getElementById('sfx-vol');
        const jumpSizeSlider = document.getElementById('jump-btn-size');
        const lvlButtons = document.querySelectorAll('.lvl-btn');

        // New graphics/experimental controls
        const gfxQuality = document.getElementById('gfx-quality');
        const expAA = document.getElementById('exp-aa');
        const expShaders = document.getElementById('exp-shaders');
        const expMega = document.getElementById('exp-mega-shaders');
        const expRay = document.getElementById('exp-raytracing');

        // Expose current experimental/graphics settings on game instance for other subsystems
        this.graphicsSettings = {
            quality: gfxQuality ? gfxQuality.value : 'medium',
            antialias: expAA ? expAA.checked : true,
            rayTracing: expRay ? expRay.checked : false
        };

        // Helper: recreate renderer when AA changes (keeps other renderer settings)
        this.recreateRenderer = (antialias) => {
            // preserve old size & pixel ratio
            const old = this.renderer;
            const size = { w: old.domElement.width, h: old.domElement.height };
            const pr = this.renderer.getPixelRatio();
            const parent = this.container;
            // remove old canvas
            try { parent.removeChild(old.domElement); } catch (e) {}
            // dispose renderer resources gently
            try { old.dispose(); } catch (e) {}
            // create new renderer with requested AA
            this.renderer = new THREE.WebGLRenderer({ antialias: !!antialias });
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            parent.appendChild(this.renderer.domElement);

            // update controls' domElement reference if present and rebind their event listeners
            if (this.controls) {
                this.controls.domElement = this.renderer.domElement;
                // ensure input handlers are bound to the new canvas / DOM element
                if (typeof this.controls.setupEvents === 'function') this.controls.setupEvents();
            }
        };

        this.isPaused = false;

        const togglePause = () => {
            this.isPaused = !this.isPaused;
            menu.style.display = this.isPaused ? 'flex' : 'none';
            this.controls.enabled = !this.isPaused;
        };

        pauseBtn.addEventListener('click', togglePause);
        resumeBtn.addEventListener('click', togglePause);

        // Ensure pause menu overlay uses a dark semi-opaque backdrop
        document.getElementById('menu-overlay').style.background = 'rgba(0,0,0,0.92)';

        musicSlider.addEventListener('input', (e) => {
            this.music.setVolume(parseFloat(e.target.value));
        });

        sfxSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (this.levelManager && this.levelManager.winSound) {
                this.levelManager.winSound.volume = v;
            }
            if (this.levelManager && this.levelManager.fallSound) {
                this.levelManager.fallSound.volume = v;
            }
            if (this.controls && this.controls.jumpSound) {
                try { this.controls.jumpSound.volume = v; } catch (err) { /* ignore */ }
            }
        });

        // Graphics control handlers
        if (gfxQuality) {
            gfxQuality.addEventListener('change', (e) => {
                this.graphicsSettings.quality = e.target.value;
                // adjust pixel ratio as a simple quality measure
                const pr = (e.target.value === 'low') ? 1 : (e.target.value === 'medium') ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
                try { this.renderer.setPixelRatio(pr); } catch (err) {}
            });
        }

        if (expAA) {
            // initialize checkbox to current renderer state
            expAA.checked = !!this.renderer.getContext().getContextAttributes().antialias;
            expAA.addEventListener('change', (e) => {
                this.graphicsSettings.antialias = e.target.checked;
                // recreate renderer to apply antialias toggle
                this.recreateRenderer(e.target.checked);
            });
        }

        if (expRay) {
            expRay.addEventListener('change', (e) => {
                this.graphicsSettings.rayTracing = e.target.checked;
                if (this.sceneRenderer) {
                    this.sceneRenderer.rayTracing = e.target.checked;
                    try { this.sceneRenderer.invalidateAllMaterials(this.scene); } catch (err) {}
                }
            });
        }

        jumpSizeSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            const btn = document.getElementById('jump-button');
            btn.style.width = `${size}px`;
            btn.style.height = `${size}px`;
            btn.style.fontSize = `${Math.max(12, size / 4.5)}px`;
        });

        lvlButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const lvl = parseInt(btn.getAttribute('data-lvl'));
                this.levelManager.loadLevel(lvl);
                togglePause();
            });
        });

        // Pause-overlay -> open customizer without leaving pause context of the game loop.
        const pauseCustomizerBtn = document.getElementById('open-customizer-btn');
        if (pauseCustomizerBtn) {
            pauseCustomizerBtn.addEventListener('click', () => {
                // Open the customizer UI and hide the pause overlay; controls remain disabled while customizing.
                try {
                    this.customizer.open();
                } catch (e) { console.warn('Failed to open customizer from pause menu', e); }
                menu.style.display = 'none';
            });
        }

        // Exit to main menu: clean up current level and return to non-blocking main menu UI.
        const exitToMainBtn = document.getElementById('exit-to-main');
        if (exitToMainBtn) {
            exitToMainBtn.addEventListener('click', () => {
                try {
                    // Hide pause overlay immediately and clear paused flag so the animate loop continues.
                    menu.style.display = 'none';
                    this.isPaused = false;
                    // Also ensure the pause overlay DOM is fully hidden (defensive)
                    try { const pauseOverlay = document.getElementById('menu-overlay'); if (pauseOverlay) pauseOverlay.style.display = 'none'; } catch(e){}

                    // Clear any loaded gameplay level and fully reset physics/world state
                    if (this.levelManager) {
                        try {
                            this.levelManager.clearLevel();
                        } catch (err) {
                            console.warn(err);
                        }
                        this._levelLoadedFromMenu = false;
                    }

                    // Ensure physics world is cleaned (remove stray bodies) and any meshes removed.
                    // Replace the PhysicsWorld instance with a fresh one to avoid stale/destroyed internals
                    // that could hang later (listeners, wasm pointers, or world state).
                    try {
                        if (this.physics && typeof this.physics.clearWorld === 'function') {
                            this.physics.clearWorld();
                        }
                    } catch (e) {
                        console.warn('Failed to clear physics world on exit-to-main', e);
                    }
                    try {
                        // Recreate a fresh physics instance and reconnect levelManager to it so future demo/levels work correctly.
                        this.physics = new (this.physics.constructor)();
                        if (this.levelManager) this.levelManager.physics = this.physics;
                    } catch (e) {
                        console.warn('Failed to recreate physics world on exit-to-main', e);
                    }

                    // Disable gameplay controls and ensure jump/joystick hidden
                    if (this.controls) {
                        this.controls.enabled = false;
                        this.controls.joystickVector && this.controls.joystickVector.set(0,0);
                        // reset control references to any level-specific ball
                        this.controls.ballMesh = null;
                    }

                    // Recreate/re-add the menu demo so the main menu shows its spinning platform and decorative marbles.
                    try {
                        // Remove any leftover demo group (safe no-op if already removed)
                        if (this.menuDemo && this.menuDemo.group) {
                            try { this.scene.remove(this.menuDemo.group); } catch (e) {}
                        }
                        // Rebuild the demo state and add to the scene
                        this.menuDemo = {
                            group: new THREE.Group(),
                            platform: null,
                            bodies: [],
                            meshes: [],
                            spawnTimer: 0
                        };
                        this.scene.add(this.menuDemo.group);
                        this.setupMenuDemo();
                    } catch (e) {
                        console.warn('Failed to restore menu demo', e);
                    }

                    // Reset camera & controls to a safe main-menu vantage so the view isn't left in an odd/editor pose.
                    try {
                        // sensible vantage that frames the right-side demo platform
                        const demoCenter = (this.menuDemo && this.menuDemo.group) ? this.menuDemo.group.position.clone() : new THREE.Vector3(6,0,-6);
                        const camPos = (this.menuDemo && this.menuDemo.demoCamPos) ? this.menuDemo.demoCamPos.clone() : new THREE.Vector3(10, 8, -10);
                        this.camera.position.copy(camPos);
                        this.camera.lookAt(demoCenter);

                        // Reset player orbit state (ensure controls are in player mode and not using editor pitch/theta)
                        if (this.controls) {
                            try { this.controls.setMode && this.controls.setMode('player'); } catch(e){}
                            this.controls.enabled = false; // keep inputs disabled while on main menu
                            this.controls.pitchDeg = 25;
                            this.controls.theta = 0;
                            this.controls.radiusDesired = THREE.MathUtils.clamp(this.controls.radiusDesired || this.controls.radius || 8, this.controls.minRadius || 0.05, this.controls.maxRadius || 20);
                            // detach any level ball reference so camera-collision raycasts won't pick up a missing ball
                            try { this.controls.ballMesh = null; } catch(e){}
                            // clear joystick state to avoid stuck inputs
                            try { this.controls.joystickVector && this.controls.joystickVector.set(0,0); this.controls.joystickVisible = false; this.controls.joystickTouchId = null; } catch(e){}
                        }
                    } catch (e) {
                        console.warn('Failed to reset camera on exit-to-main', e);
                    }

                    // Show main menu
                    this.showMainMenu();
                } catch (err) {
                    console.warn('Failed to exit to main menu', err);
                }
            });
        }
    }

    // ---- Main menu demo helpers ----
    setupMenuDemo() {
        // spinning platform (visual only + static body) -- placed on the RIGHT side for menu background
        const geo = new THREE.BoxGeometry(8, 0.6, 8);
        // Use sceneRenderer's platform material to add the textured/noisy appearance consistently
        const platMat = (this.sceneRenderer && typeof this.sceneRenderer.createPlatformMaterial === 'function')
            ? this.sceneRenderer.createPlatformMaterial(0x667788)
            : new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.8 });
        const plat = new THREE.Mesh(geo, platMat);
        // move demo platform to the right side (x = +6)
        plat.position.set(6, 0.8, -6);
        plat.receiveShadow = true;
        this.menuDemo.group.add(plat);
        this.menuDemo.platform = plat;
        // Demo camera fixed position & rotation (applied directly)
        try {
            // Demo camera values (paste into code)
            this.menuDemo.demoCamPos = new THREE.Vector3(2.8, 9.5, 8.4);
            // If the camera already exists use it immediately; otherwise the Game constructor will apply later.
            if (this.camera) {
                this.camera.position.copy(this.menuDemo.demoCamPos);
                this.camera.rotation.set(
                    THREE.MathUtils.degToRad(339),
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(0)
                );
            }
        } catch (e) {
            this.menuDemo.demoCamPos = new THREE.Vector3(2.8, 9.5, 8.4);
        }

        // create a kinematic physics body for the platform so marbles experience friction from rotation
        const shape = new CANNON.Box(new CANNON.Vec3(4, 0.3, 4));
        const body = new CANNON.Body({ mass: 0, shape, material: this.physics.groundMaterial });
        // Try to set kinematic type (so collisions treat it as moving but not simulated by forces)
        try { body.type = CANNON.Body.KINEMATIC; } catch (e) {}
        body.position.set(plat.position.x, plat.position.y, plat.position.z);
        // initialize quaternion to match mesh
        const q = plat.quaternion;
        body.quaternion.set(q.x, q.y, q.z, q.w);
        this.physics.world.addBody(body);
        this.menuDemo.platformBody = body;
        // track previous yaw for angular velocity calculation
        this.menuDemo._prevPlatformYaw = plat.rotation.y;

        // NOTE: removed broad invisible ground to ensure demo marbles fall into the void when not contacting the visible platform.
        // Keeping only the visible spinning platform's static/kinematic body ensures marbles land on the platform and not an unseen plane.
        this.menuDemo.groundBody = null;

        // Create a dedicated physics material for menu marbles so they have tuned friction/restitution
        // This ensures the demo marbles behave with real friction when sliding on the spinning demo platform
        try {
            this.menuDemo.ballMaterial = new CANNON.Material('menuBall');
            // High friction so marbles don't slide unrealistically on the spinning demo platform
            const contact = new CANNON.ContactMaterial(this.menuDemo.ballMaterial, this.physics.groundMaterial, {
                friction: 0.85,
                restitution: 0.08
            });
            // Add to world contact materials so collisions use these parameters
            this.physics.world.addContactMaterial(contact);
        } catch (e) {
            // If Cannon material creation fails, fallback to using existing ballMaterial (already used elsewhere)
            this.menuDemo.ballMaterial = this.physics.ballMaterial;
        }
    }

    spawnMenuMarble() {
        // simple decorative marble: independent body+mesh so it won't interfere with main ball
        const radius = 0.35 + Math.random() * 0.25;
        const col = new THREE.Color().setHSL(Math.random(), 0.7, 0.5).getHex();
        // Build a decorative marble using the same material generator as the player marble
        const ballParams = {
            color: col,
            shininess: Math.random() * 0.9 + 0.05,
            textureType: ['none','dots','waves','triangles','noise'][Math.floor(Math.random() * 5)],
            textureAlpha: Math.random() * 0.9 + 0.05
        };
        const mat = (this.sceneRenderer && typeof this.sceneRenderer.createBallMaterial === 'function')
            ? this.sceneRenderer.createBallMaterial(ballParams)
            : new THREE.MeshStandardMaterial({ color: col });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 24), mat);
        // persist params so inspector/material invalidation code can re-create similar visuals if needed
        mesh.userData = mesh.userData || {};
        mesh.userData.ballParams = JSON.parse(JSON.stringify(ballParams));

        // Spawn the marble directly above the demo platform (if available), otherwise use a sensible fallback.
        const platPos = (this.menuDemo && this.menuDemo.platform) ? this.menuDemo.platform.position : new THREE.Vector3(6, 0.8, -6);
        // Slight random horizontal offset around the platform center so marbles don't all stack perfectly.
        const px = platPos.x + (Math.random() - 0.5) * 2.0;
        // Spawn height: a few units above the platform so marbles visibly fall onto it.
        const py = platPos.y + 4.0 + Math.random() * 2.0;
        const pz = platPos.z + (Math.random() - 0.5) * 2.0;
        mesh.position.set(px, py, pz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.menuDemo.group.add(mesh);

        const shape = new CANNON.Sphere(radius);
        const body = new CANNON.Body({
            mass: 0.6,
            shape,
            // Use the dedicated menu ball material if created, otherwise fallback to physics.ballMaterial
            material: (this.menuDemo && this.menuDemo.ballMaterial) ? this.menuDemo.ballMaterial : this.physics.ballMaterial,
            linearDamping: 0.05,
            angularDamping: 0.2
        });
        body.position.set(px, py, pz);
        // give a small random outward velocity so marbles nudge onto the platform naturally
        const vx = (Math.random() - 0.5) * 1.5 + 0.6;
        const vy = -2 - Math.random() * 1.2;
        const vz = (Math.random() - 0.5) * 1.5;
        body.velocity.set(vx, vy, vz);
        this.physics.world.addBody(body);

        this.menuDemo.meshes.push(mesh);
        this.menuDemo.bodies.push(body);

        // Enforce a maximum of 15 demo marbles; remove oldest when the cap is reached before adding a new one.
        while (this.menuDemo.bodies.length >= 15) {
            const b = this.menuDemo.bodies.shift();
            try { this.physics.world.removeBody(b); } catch(e){}
            const m = this.menuDemo.meshes.shift();
            try { this.menuDemo.group.remove(m); } catch(e){}
        }
    }

    updateMenuDemo(dt) {
        if (!this.menuEl || this.menuEl.style.display === 'none') return;

        // rotate platform around Y (medium-fast)
        if (this.menuDemo.platform && this.menuDemo.platformBody) {
            // rotate visual mesh
            const prevYaw = this.menuDemo._prevPlatformYaw || this.menuDemo.platform.rotation.y;
            const speed = 2.2; // rad/s rotational speed (medium-fast, slightly increased)
            const newYaw = prevYaw + dt * speed;
            this.menuDemo.platform.rotation.y = newYaw;

            // compute delta yaw and set physics body quaternion + angular velocity so friction transfers to contacting balls
            const halfAngle = (newYaw - prevYaw) * 0.5;
            // set quaternion directly from Euler (safe)
            const q = new THREE.Quaternion().setFromEuler(this.menuDemo.platform.rotation);
            this.menuDemo.platformBody.quaternion.set(q.x, q.y, q.z, q.w);

            // angular velocity around Y = deltaAngle / dt
            const angVelY = (newYaw - prevYaw) / Math.max(dt, 1e-6);
            try {
                // ensure body is kinematic for velocity updates
                try { this.menuDemo.platformBody.type = CANNON.Body.KINEMATIC; } catch (e) {}
                if (this.menuDemo.platformBody.angularVelocity) {
                    this.menuDemo.platformBody.angularVelocity.set(0, angVelY, 0);
                } else {
                    this.menuDemo.platformBody.angularVelocity = new CANNON.Vec3(0, angVelY, 0);
                }
            } catch (e) {
                // fallback: nop
            }

            // store for next frame
            this.menuDemo._prevPlatformYaw = newYaw;
        }

        // spawn marbles periodically
        this.menuDemo.spawnTimer -= dt;
        if (this.menuDemo.spawnTimer <= 0) {
            this.spawnMenuMarble();
            this.menuDemo.spawnTimer = 0.35 + Math.random() * 0.9;
        }

        // sync meshes with bodies
        for (let i = 0; i < this.menuDemo.bodies.length; i++) {
            const b = this.menuDemo.bodies[i];
            const m = this.menuDemo.meshes[i];
            if (!b || !m) continue;
            m.position.copy(b.position);
            m.quaternion.copy(b.quaternion);
            // remove any marble that fell too far
            if (b.position.y < -18) {
                try { this.physics.world.removeBody(b); } catch(e){}
                try { this.menuDemo.group.remove(m); } catch(e){}
                this.menuDemo.bodies.splice(i, 1);
                this.menuDemo.meshes.splice(i, 1);
                i--;
            }
        }
    }

    showMainMenu() {
        if (this.menuEl) this.menuEl.style.display = 'flex';
        this.menuVisible = true;

        // Ensure the demo camera vignette is applied when showing the main menu.
        // If a demo camera position is available, snap the camera to it and apply the stored demo rotation.
        try {
            if (this.menuDemo && this.menuDemo.demoCamPos) {
                // Position camera to the demo saved vantage
                this.camera.position.copy(this.menuDemo.demoCamPos);
                // If a rotation was stored earlier use it; otherwise keep existing rotation but ensure we set a sane look
                try {
                    // The demo uses an explicit rotation set as Euler on initialization; re-apply same values for consistency.
                    this.camera.rotation.set(
                        THREE.MathUtils.degToRad(339),
                        THREE.MathUtils.degToRad(0),
                        THREE.MathUtils.degToRad(0)
                    );
                } catch (e) {
                    // fallback: look at demo center if rotation application fails
                    const demoCenter = this.menuDemo.group ? this.menuDemo.group.position.clone() : new THREE.Vector3(0, 0, 0);
                    this.camera.lookAt(demoCenter);
                }
            }
        } catch (e) {
            // swallow to avoid breaking menu show
        }

        // Disable player input and camera while menu is open
        if (this.controls) {
            this.controls.enabled = false;
            // Force clear any movement state so keys/joystick won't linger
            this.controls.joystickVector && this.controls.joystickVector.set(0, 0);
            this.controls.joystickVisible = false;
            this.controls.joystickTouchId = null;
            // clear keyboard state
            if (this.controls.keys) {
                this.controls.keys.forward = this.controls.keys.back = this.controls.keys.left = this.controls.keys.right = false;
            }

            // Also nudge internal orbit state so future transitions from menu to gameplay are predictable.
            try {
                this.controls.pitchDeg = 25;
                this.controls.theta = 0;
                this.controls.radiusDesired = this.controls.radius = 8;
                // detach any ball reference so camera-collision raycasts won't pick up a missing ball
                this.controls.ballMesh = null;
            } catch (e) {}
        }

        // Hide/disable on-screen joystick and jump button while in menu
        const joy = document.getElementById('joystick-container');
        if (joy) joy.style.display = 'none';
        const jb = document.getElementById('jump-button');
        if (jb) {
            jb.style.display = 'none';
            jb.style.pointerEvents = 'none';
            jb.setAttribute('aria-hidden', 'true');
        }

        // Hide the pause button while the main menu is visible so users can't pause the demo from the menu
        try {
            const pauseBtn = document.getElementById('pause-button');
            if (pauseBtn) {
                pauseBtn.style.display = 'none';
                pauseBtn.setAttribute('aria-hidden', 'true');
            }
        } catch (e) {}
    }

    hideMainMenu() {
        if (this.menuEl) this.menuEl.style.display = 'none';
        this.menuVisible = false;

        // Re-enable player input and camera when the menu is closed.
        try {
            if (this.controls) {
                // Leave event bindings intact but enable updates so camera & joystick resume.
                this.controls.enabled = true;
                // Ensure joystick state cleaned so it doesn't remain logically active.
                this.controls.joystickVector && this.controls.joystickVector.set(0, 0);
                this.controls.joystickVisible = false;
                this.controls.joystickTouchId = null;
            }
        } catch (e) {}

        // Restore pause button visibility when returning from the main menu
        try {
            const pauseBtn = document.getElementById('pause-button');
            if (pauseBtn) {
                pauseBtn.style.display = 'flex';
                pauseBtn.removeAttribute('aria-hidden');
            }
        } catch (e) {}

        // Restore on-screen UI (jump/joystick) according to device state
        try {
            const isMobile = (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
            const jb = document.getElementById('jump-button');
            const joy = document.getElementById('joystick-container');
            if (jb) jb.style.display = isMobile ? 'flex' : 'none';
            if (joy) joy.style.display = 'none';
        } catch (e) {}
    }

    // Loading overlay helpers
    showLoading(text = 'Preparing level') {
        try {
            const overlay = document.getElementById('loading-overlay');
            const sub = document.getElementById('loading-sub');
            const bar = document.getElementById('loading-bar');
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.style.pointerEvents = 'auto';
            }
            if (sub) sub.innerText = text;
            if (bar) {
                bar.style.width = '12%';
                // simple animated progress until hidden
                setTimeout(()=> bar.style.width = '48%', 200);
                setTimeout(()=> bar.style.width = '76%', 600);
            }
        } catch (e) {}
    }

    hideLoading() {
        try {
            const overlay = document.getElementById('loading-overlay');
            const bar = document.getElementById('loading-bar');
            if (bar) bar.style.width = '100%';
            setTimeout(() => {
                try {
                    if (overlay) {
                        overlay.style.display = 'none';
                        overlay.style.pointerEvents = 'none';
                    }
                    if (bar) bar.style.width = '0%';
                } catch (e) {}
            }, 280);
        } catch (e) {}
    }

    /**
     * startGame()
     * Called when the player presses Play from the main menu.
     * - Clears demo marbles & menu platform bodies/meshes
     * - Loads level 1 (index 0) if not already loaded
     * - Enables controls and re-enables jump/joystick UI appropriate for device
     */
    startGame() {
        // Remove decorative demo bodies and meshes (safely)
        try {
            if (this.menuDemo) {
                // remove physics bodies
                if (this.menuDemo.bodies && this.physics && this.physics.world) {
                    for (const b of this.menuDemo.bodies) {
                        try { this.physics.world.removeBody(b); } catch (e) {}
                    }
                    this.menuDemo.bodies = [];
                }
                // remove meshes
                if (this.menuDemo.meshes && this.menuDemo.group) {
                    for (const m of this.menuDemo.meshes) {
                        try { this.menuDemo.group.remove(m); } catch (e) {}
                    }
                    this.menuDemo.meshes = [];
                }
                // remove platform body if present
                try {
                    if (this.menuDemo.platformBody && this.physics && this.physics.world) {
                        try { this.physics.world.removeBody(this.menuDemo.platformBody); } catch (e) {}
                        this.menuDemo.platformBody = null;
                    }
                    // Remove the demo ground body if it exists so we don't leak static bodies between modes
                    if (this.menuDemo.groundBody && this.physics && this.physics.world) {
                        try { this.physics.world.removeBody(this.menuDemo.groundBody); } catch (e) {}
                        this.menuDemo.groundBody = null;
                    }
                } catch (e) {}
                // remove visual platform mesh if present
                try { 
                    if (this.menuDemo.platform && this.menuDemo.group) {
                        this.menuDemo.group.remove(this.menuDemo.platform);
                        this.menuDemo.platform = null;
                    }
                } catch(e){}
                // Optionally remove the demo group from the scene to avoid duplicate groups; we'll recreate on exit-to-main if needed.
                try { 
                    if (this.menuDemo.group) {
                        this.scene.remove(this.menuDemo.group);
                    }
                } catch(e) {}
            }
        } catch (e) {}

        // Hide menu UI
        this.hideMainMenu();

        // Load the actual gameplay level if not already loaded
        if (this.levelManager && !this._levelLoadedFromMenu) {
            // show loading overlay while creating level
            this.showLoading('Loading Level 1...');
            // small timeout to allow overlay render, then load level and hide overlay
            setTimeout(() => {
                try {
                    this.levelManager.loadLevel(0);
                } catch (e) {
                    console.warn('Level load failed', e);
                }
                this._levelLoadedFromMenu = true;
                // Ensure controls reference the created ball
                if (this.controls) this.controls.ballMesh = this.levelManager.ball;
                // hide loading overlay after a short settle
                setTimeout(() => this.hideLoading(), 250);
            }, 60);
        }

        // Re-enable controls now that gameplay begins
        if (this.controls) {
            this.controls.enabled = true;
        }

        // Restore jump button visibility on mobile if applicable
        const isMobile = (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
        const jb = document.getElementById('jump-button');
        if (jb) {
            jb.style.display = isMobile ? 'flex' : 'none';
            jb.style.pointerEvents = isMobile ? 'auto' : 'none';
            if (isMobile) jb.removeAttribute('aria-hidden');
        }

        // Ensure joystick UI resets (InputHandler will manage showing it on touch start)
        const joy = document.getElementById('joystick-container');
        if (joy) joy.style.display = 'none';
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1);
        this.lastTime = currentTime;

        if (!this.isPaused) {
            // Update Physics
            this.physics.update(deltaTime);
            
            // Update Level Logic (Checkpoints, Falling, Win areas)
            this.levelManager.update(deltaTime);

            // Update Controls & Force Application
            this.controls.update(deltaTime, this.physics.ballBody);
        }

        // Render
        this.renderer.render(this.scene, this.camera);
        
        // Update level display
        if (this.levelManager.levelChanged) {
            this.levelDisplay.innerText = `Level ${this.levelManager.currentLevelIndex + 1}`;
            this.levelManager.levelChanged = false;
            // Update controls with new ball mesh
            this.controls.ballMesh = this.levelManager.ball;
        }

        // Editor specific visibilities
        if (this.editor.active) {
            this.levelDisplay.style.display = 'none';
        } else {
            this.levelDisplay.style.display = 'block';
        }

        // Update dynamic environment map for simple "ray-tracing" reflections if enabled
        if (this.sceneRenderer && this.sceneRenderer.rayTracing) {
            try {
                // prefer focusing envmap updates at the player's marble so reflections show floors/nearby objects on the ball
                const focus = (this.levelManager && this.levelManager.ball) ? this.levelManager.ball.position : this.camera.position;
                if (typeof this.sceneRenderer.updateEnvMap === 'function') {
                    this.sceneRenderer.updateEnvMap(this.renderer, this.camera, focus);
                }
            } catch (e) {
                // swallow to avoid breaking main loop
            }
        }

        // Update main-menu background demo when visible
        if (this.menuVisible && !this.editor.active) {
            try { this.updateMenuDemo(deltaTime); } catch (e) {}

            // demo camera is fixed via demoCamPos; no live slider adjustments
        } else {
            // if first frame after init, show menu
            if (typeof this.menuVisible === 'undefined') {
                this.showMainMenu();
            }
        }
    }
}

new Game();

