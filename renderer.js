import * as THREE from 'three';

export class SceneRenderer {
    constructor(scene) {
        this.scene = scene;
        this.textureLoader = new THREE.TextureLoader();

        // Graphics feature flags (can be toggled at runtime)
        // experimental/mega shader flags removed - only real-time environment reflections remain
        this.rayTracing = false;

        // CubeCamera used to generate dynamic environment maps for reflections
        this._cubeCamera = null;
        this._envUpdateLast = 0;
        this._envUpdateInterval = 250; // ms between updates to balance perf
    }

    setupLighting() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(20, 40, 20);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.camera.left = -100;
        sun.shadow.camera.right = 100;
        sun.shadow.camera.top = 100;
        sun.shadow.camera.bottom = -100;
        this.scene.add(sun);
        
        // Skybox - Cloud Sky asset
        this.textureLoader.load('1eprhbtmvoo51.png', (tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.background = tex;
            this.scene.environment = tex;
        });

        // Prepare cube camera for dynamic environment map updates (initialized lazily when renderer is provided)
    }

    /**
     * createBallMaterial(params)
     * - Honors the renderer's experimental flags:
     *   - experimentalShaders: injects a subtle rim shader via onBeforeCompile
     *   - megaShaders: amplifies clearcoat/metalness for flashy look
     *   - rayTracing: uses scene.environment as envMap to simulate reflections
     */
    createBallMaterial(params = {}) {
        const {
            color = 0xffffff,
            shininess = 0.5,
            textureType = 'noise',
            textureAlpha = 0.5
        } = params;

        // Map shininess (0 to 1) to roughness (0.8 to 0.05)
        let roughness = 0.8 - (shininess * 0.75);
        let metalness = shininess * 0.4;
        let clearcoat = shininess;
        let clearcoatRoughness = 0.1;

        // note: megaShaders/experimental shader branches removed in favor of a singular dynamic envMap approach

        const texture = this.generateCustomTexture(color, textureType, textureAlpha);

        const mat = new THREE.MeshPhysicalMaterial({
            color: color,
            metalness: metalness,
            roughness: roughness,
            clearcoat: clearcoat,
            clearcoatRoughness: clearcoatRoughness,
            map: texture,
            emissive: new THREE.Color(color).multiplyScalar(0.08),
            // Only bind envMap when rayTracing is enabled; envMap will be updated dynamically by updateEnvMap()
            envMap: (this.rayTracing && this.scene && this.scene.environment) ? this.scene.environment : null,
            envMapIntensity: this.rayTracing ? 1.5 : 0.6,
        });
        // Ensure the material picks up envMap changes immediately when we assign a dynamic cubemap
        mat.needsUpdate = true;

        // experimental shader injection removed; environment reflections are driven by a dynamic cube camera when rayTracing is enabled.

        return mat;
    }

    generateCustomTexture(baseColor, type, alpha) {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Ensure baseColor is a readable CSS color (Three may pass hex or number)
        const base = (typeof baseColor === 'string') ? baseColor : ('#' + new THREE.Color(baseColor).getHexString());

        // Base color fill
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        // Prepare drawing style (use black-ish marks over the base)
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#000000';

        // Helper to draw shapes with per-shape alpha to make opacity visible
        const drawAlpha = (a, fn) => {
            ctx.globalAlpha = a;
            fn();
            ctx.globalAlpha = 1;
        };

        if (type === 'dots') {
            for (let i = 0; i < 120; i++) {
                drawAlpha(alpha * (0.4 + Math.random() * 0.8), () => {
                    ctx.beginPath();
                    ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 18 + 4, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        } else if (type === 'waves') {
            ctx.lineWidth = 8;
            for (let i = 0; i < 14; i++) {
                drawAlpha(alpha * (0.6 - i * 0.03), () => {
                    ctx.beginPath();
                    const yBase = (i / 14) * size;
                    ctx.moveTo(0, yBase);
                    for (let x = 0; x < size; x += 8) {
                        ctx.lineTo(x, yBase + Math.sin(x * 0.05 + i) * 26);
                    }
                    ctx.stroke();
                });
            }
        } else if (type === 'triangles') {
            // Fewer triangles but with varied alpha so they behave like a pattern
            for (let i = 0; i < 18; i++) {
                drawAlpha(alpha * (0.3 + Math.random() * 0.9), () => {
                    ctx.beginPath();
                    ctx.moveTo(Math.random() * size, Math.random() * size);
                    ctx.lineTo(Math.random() * size, Math.random() * size);
                    ctx.lineTo(Math.random() * size, Math.random() * size);
                    ctx.closePath();
                    ctx.fill();
                });
            }
        } else if (type === 'noise') {
            for (let i = 0; i < 5000; i++) {
                drawAlpha(alpha * (0.1 + Math.random() * 0.9), () => {
                    const x = Math.random() * size;
                    const y = Math.random() * size;
                    const r = Math.random() * 2 + 0.4;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 1);
        tex.needsUpdate = true;
        return tex;
    }

    createPlatformMaterial(color) {
        // Convert input color to string for canvas
        const colorHex = typeof color === 'string' ? color : '#' + new THREE.Color(color).getHexString();
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: this.megaShaders ? 0.45 : 0.2,
            map: this.createNoiseTexture(colorHex, '#ffffff', 0.15)
        });

        // If rayTracing mode is active, add environment reflection from the scene.environment
        if (this.rayTracing && this.scene && this.scene.environment) {
            mat.envMap = this.scene.environment;
            mat.envMapIntensity = 0.6;
        }

        mat.needsUpdate = true;
        return mat;
    }

    createNoiseTexture(color1, color2, mix = 0.5) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = color1;
        ctx.fillRect(0, 0, size, size);
        
        // Add some "architectural" grain
        for(let i=0; i<3000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = Math.random() * 2 + 1;
            ctx.fillStyle = color2; // Use white for highlight grain
            ctx.globalAlpha = Math.random() * mix;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI*2);
            ctx.fill();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        return tex;
    }

    /**
     * invalidateAllMaterials(scene)
     * Walks the scene and re-creates materials for known object types so toggles take effect immediately.
     */
    invalidateAllMaterials(scene) {
        if (!scene) return;
        scene.traverse((obj) => {
            if (!obj.isMesh) return;

            // Heuristic: ball sphere uses SphereGeometry with small radius (0.5). Replace with createBallMaterial
            if (obj.geometry && obj.geometry.type === 'SphereGeometry') {
                // Prefer stored ball params on the mesh (set when the ball was created/randomized/customized)
                let params = { color: 0xffffff, shininess: 0.5, textureType: 'noise', textureAlpha: 0.3 };
                try {
                    if (obj.userData && obj.userData.ballParams) {
                        params = Object.assign({}, params, obj.userData.ballParams);
                    } else if (obj.material && obj.material.color) {
                        // Fallback: infer color from old material
                        params.color = obj.material.color.getHex();
                    }
                } catch (e) {
                    // keep defaults on error
                }

                // recreate using the preserved params so textures/alpha/shininess remain consistent
                const newMat = this.createBallMaterial(params);
                // dispose old textures/material
                try {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                } catch (e) {}
                obj.material = newMat;
                // ensure the mesh keeps a copy of the params for future invalidations
                try {
                    obj.userData = obj.userData || {};
                    obj.userData.ballParams = Object.assign({}, params);
                } catch (e) {}
                return;
            }

            // Platforms: BoxGeometry typical; recreate platform material
            if (obj.geometry && obj.geometry.type === 'BoxGeometry') {
                let baseColor = 0x888888;
                if (obj.material && obj.material.color) baseColor = obj.material.color.getHex();
                const newMat = this.createPlatformMaterial(baseColor);
                try {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                } catch (e) {}
                obj.material = newMat;
                return;
            }

            // Generic fallback: mark material needs update
            try {
                obj.material.needsUpdate = true;
            } catch (e) {}
        });
    }

    /**
     * setRenderer(renderer, camera)
     * Provide the Three renderer and the main camera so the SceneRenderer can drive a dynamic cube camera.
     */
    setRenderer(renderer, camera) {
        this._renderer = renderer;
        this._mainCamera = camera;
        if (!this._cubeCamera) {
            const cubeSize = 256;
            this._cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeSize);
            // Defensive: set texture.encoding to match renderer outputEncoding if available
            try {
                if (this._cubeCamera.renderTarget && this._cubeCamera.renderTarget.texture) {
                    const enc = (renderer && renderer.outputEncoding) ? renderer.outputEncoding : THREE.sRGBEncoding;
                    this._cubeCamera.renderTarget.texture.encoding = enc;
                }
            } catch (e) {
                // swallow any errors here to avoid breaking initialization in edge cases
            }
            this.scene.add(this._cubeCamera);
        }
    }

    /**
     * updateEnvMap(renderer, camera, focusPosition)
     * Updates the cube camera and assigns its texture to scene.environment and to materials that support envMap.
     * Throttled to avoid heavy cost every frame. When provided, the cube camera is positioned at focusPosition
     * (useful to render accurate reflections from the marble's location).
     */
    updateEnvMap(renderer, camera, focusPosition = null) {
        if (!this.rayTracing || !this._cubeCamera || !this._renderer || !this._mainCamera) return;
        const now = performance.now();
        if ((now - this._envUpdateLast) < this._envUpdateInterval) return;
        this._envUpdateLast = now;

        // Prefer focusing the cube camera at the provided focusPosition (e.g. the marble) so reflections include nearby floors/objects.
        if (focusPosition && (focusPosition.x !== undefined)) {
            this._cubeCamera.position.copy(focusPosition);
        } else {
            // fallback to main camera position if no focus provided
            this._cubeCamera.position.copy(this._mainCamera.position);
        }

        // Ensure the cube camera's renderTarget texture encoding matches the renderer just before rendering.
        try {
            if (this._cubeCamera.renderTarget && this._cubeCamera.renderTarget.texture && renderer && renderer.outputEncoding) {
                this._cubeCamera.renderTarget.texture.encoding = renderer.outputEncoding;
            }
        } catch (e) {}

        // Render the scene into the cube render target
        this._cubeCamera.update(this._renderer, this.scene);

        // Assign cube texture as environment for scene and update materials
        this.scene.environment = this._cubeCamera.renderTarget.texture;

        // Force known materials to pick up the new environment
        this.invalidateAllMaterials(this.scene);
    }
}

