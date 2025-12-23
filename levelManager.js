import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { registerLevels } from './levelDefs.js';
import { registerMechanics } from './mechanics.js';

/*
  Refactored LevelManager:
  - Core responsibilities remain: create platforms/ball/win area, manage state and update loop.
  - Level definitions moved to levelDefs.js and mechanics (checkpoints/jumppads/cannons) to mechanics.js.
  - Removed large inline level functions (see tombstones below).
*/

export class LevelManager {
    constructor(scene, physics, sceneRenderer) {
        this.scene = scene;
        this.physics = physics;
        this.sceneRenderer = sceneRenderer;
        
        this.ball = null;
        this.ballBody = null;
        this.currentBallParams = null;
        this.checkpoint = new THREE.Vector3(0, 2, 0);
        this.currentLevelIndex = 0;
        this.levelChanged = false;
        
        this.winArea = null;
        this.winSize = 2;
        
        this.platforms = [];

        // keep mapping of platform meshes -> their static physics bodies so editor can update collisions
        this.platformBodies = []; // { mesh, body }

        // gameplay objects managed by mechanics module
        this.checkpoints = [];   // {mesh, position, activated}
        this.jumppads = [];      // {mesh, position, dir, power}
        this.cannons = [];       // {mesh, position, dir, power, cooldown, lastFired}

        this.fallSound = new Audio('fall.mp3');
        this.fallSound.load();
        this.winSound = new Audio('win.mp3');
        this.winSound.load();

        this.checkpointSound = new Audio('win.mp3');
        this.checkpointSound.load();

        // Register external level defs and mechanics with 'this' manager
        // registerLevels must come first to initialize the levels array
        registerLevels(this);
        registerMechanics(this);
    }

    loadLevel(index) {
        this.currentLevelIndex = index;
        this.clearLevel();

        // level registry applied in levelDefs.js by registerLevels
        if (this._levels && this._levels[index]) {
            this._levels[index]();
        } else {
            // fallback: wrap to first
            if (this._levels && this._levels[0]) this._levels[0]();
            this.currentLevelIndex = 0;
        }

        this.levelChanged = true;
    }

    clearLevel() {
        this.physics.clearWorld();
        this.platforms.forEach(p => this.scene.remove(p));
        this.platforms = [];
        // remove mechanics-managed meshes
        if (this.checkpoints) this.checkpoints.forEach(cp => this.scene.remove(cp.mesh));
        if (this.jumppads) this.jumppads.forEach(jp => this.scene.remove(jp.mesh));
        if (this.cannons) this.cannons.forEach(c => this.scene.remove(c.mesh));
        this.checkpoints = [];
        this.jumppads = [];
        this.cannons = [];

        if (this.ball) { this.scene.remove(this.ball); this.ball = null; }
        if (this.winArea) { this.scene.remove(this.winArea); this.winArea = null; this.winPosition = null; }
    }

    createPlatform(x, y, z, w, h, d, color = 0x44aa88) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            this.sceneRenderer.createPlatformMaterial(color)
        );
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.platforms.push(mesh);
        
        // create/add the static physics body and remember it so editor can update/replace it later
        const body = this.physics.addBox(
            new CANNON.Vec3(x, y, z),
            new CANNON.Vec3(w/2, h/2, d/2)
        );
        // store a reference for later updates
        mesh.userData.physicsBody = body;
        this.platformBodies.push({ mesh, body, size: new THREE.Vector3(w, h, d) });
        
        return mesh;
    }

    createBall(x, y, z) {
        const savedSettings = localStorage.getItem('marbleSettings');
        const params = savedSettings ? JSON.parse(savedSettings) : {
            color: '#ffffff',
            shininess: 0.5,
            textureType: 'noise',
            textureAlpha: 0.3
        };

        this.ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 32, 32),
            this.sceneRenderer.createBallMaterial(params)
        );
        // persist the visual params on the mesh so material recreation can restore full appearance
        this.ball.userData = this.ball.userData || {};
        this.ball.userData.ballParams = JSON.parse(JSON.stringify(params));

        this.ball.position.set(x, y, z);
        this.ball.castShadow = true;
        this.scene.add(this.ball);
        
        this.ballBody = this.physics.addBall(new CANNON.Vec3(x, y, z));
        this.physics.meshPairs.push({ mesh: this.ball, body: this.ballBody });
        
        this.checkpoint.set(x, y + 1, z);
        this.currentBallParams = params;
        this.randomizeBallAppearance();
    }

    createWinArea(x, y, z) {
        const group = new THREE.Group();
        
        // Pole
        const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.5);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.75;
        group.add(pole);

        // Flag
        const flagGeo = new THREE.PlaneGeometry(1.2, 0.8);
        const flagTex = new THREE.TextureLoader().load('flag_texture.png');
        const flagMat = new THREE.MeshStandardMaterial({ 
            map: flagTex, 
            side: THREE.DoubleSide,
            color: 0xff0000 
        });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(0.6, 3, 0);
        group.add(flag);

        // Base/Ring
        const geo = new THREE.RingGeometry(1.2, 1.8, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        group.add(ring);

        // Editor collision box for win area: invisible selection target matching the visual extents
        const bboxW = 2.4, bboxH = 4.0, bboxD = 2.0;
        const boxGeo = new THREE.BoxGeometry(bboxW, bboxH, bboxD);
        const boxMat = new THREE.MeshBasicMaterial({ visible: false });
        const collisionBox = new THREE.Mesh(boxGeo, boxMat);
        // center box to cover pole and flag; position relative to group origin
        collisionBox.position.set(0.6, 1.9, 0);
        collisionBox.userData = collisionBox.userData || {};
        collisionBox.userData.isCustom = true;           // editor selection recognizes it
        collisionBox.userData.editorCollision = true;
        group.add(collisionBox);

        group.position.set(x, y, z);
        this.scene.add(group);
        this.winArea = group;
        this.winPosition = new THREE.Vector3(x, y, z);
    }

    update(dt) {
        if (!this.ballBody) return;

        // Reset if fall
        if (this.ballBody.position.y < -15) {
            this.resetToLastCheckpoint();
        }

        // Check win
        if (this.winPosition) {
            const dist = new THREE.Vector3(this.ballBody.position.x, 0, this.ballBody.position.z)
                        .distanceTo(new THREE.Vector3(this.winPosition.x, 0, this.winPosition.z));
            if (dist < 1.8 && Math.abs(this.ballBody.position.y - this.winPosition.y) < 3) {
                this.winSound.currentTime = 0;
                this.winSound.play().catch(() => {});
                this.loadLevel(this.currentLevelIndex + 1);
                return;
            }
        }

        // Animate win area - rotate around Y (pole)
        if (this.winArea) {
            this.winArea.rotation.y += dt;
            const s = 1 + Math.sin(performance.now() * 0.005) * 0.1;
            if (this.winArea.children[2]) this.winArea.children[2].scale.set(s, s, s); // Pulse ring
        }

        // Delegate mechanics update (checkpoints / jumppads / cannons)
        if (this._mechanics && this._mechanics.update) {
            this._mechanics.update(dt, this.ballBody);
        }
    }

    resetToLastCheckpoint() {
        if (!this.ballBody) return;
        this.ballBody.position.copy(this.checkpoint);
        this.ballBody.velocity.set(0, 0, 0);
        this.ballBody.angularVelocity.set(0, 0, 0);
        this.randomizeBallAppearance();
        
        this.fallSound.currentTime = 0;
        this.fallSound.volume = 0.3;
        this.fallSound.play().catch(() => {});
    }

    randomizeBallAppearance() {
        // Only randomize if no custom settings exist, otherwise keep user choices
        if (!this.ball || localStorage.getItem('marbleSettings')) return;

        const textureTypes = ['none', 'dots', 'waves', 'triangles', 'noise'];
        const randomParams = {
            // Select from the same 32 hue-based colors used in the customizer
            color: '#' + new THREE.Color().setHSL(Math.floor(Math.random() * 32) / 32, 0.8, 0.6).getHexString(),
            shininess: Math.random(),
            textureType: textureTypes[Math.floor(Math.random() * textureTypes.length)],
            textureAlpha: Math.random()
        };

        const newMat = this.sceneRenderer.createBallMaterial(randomParams);
        if (this.ball.material) {
            // Dispose of the old material and its textures to prevent memory leaks
            if (this.ball.material.map) this.ball.material.map.dispose();
            this.ball.material.dispose();
        }
        this.ball.material = newMat;
        this.currentBallParams = randomParams;

        // Also persist the randomized params to the mesh userData so material recreation preserves texture choices
        this.ball.userData = this.ball.userData || {};
        this.ball.userData.ballParams = JSON.parse(JSON.stringify(randomParams));
    }

    /**
     * updatePlatformBody(mesh)
     * Rebuilds or repositions the static physics body for a platform mesh based on its current transform and scale.
     * This approach removes the old static body and creates a new one via PhysicsWorld.addBox to keep the physics world aligned with editor edits.
     */
    updatePlatformBody(mesh) {
        if (!mesh || !mesh.userData) return;
        try {
            // find existing record
            const recIndex = this.platformBodies.findIndex(pb => pb.mesh === mesh);
            let old = null;
            if (recIndex !== -1) {
                old = this.platformBodies[recIndex].body;
                // remove old body from physics world if present
                try { this.physics.world.removeBody(old); } catch (e) {}
                this.platformBodies.splice(recIndex, 1);
            } else if (mesh.userData.physicsBody) {
                old = mesh.userData.physicsBody;
                try { this.physics.world.removeBody(old); } catch (e) {}
            }

            // determine new half-extents from visual scale & geometry.
            // If the mesh uses BoxGeometry(w,h,d) the geometry parameters are preserved in geometry.parameters
            let w = 1, h = 1, d = 1;
            try {
                const gp = mesh.geometry && mesh.geometry.parameters;
                if (gp && typeof gp.width !== 'undefined') {
                    w = gp.width * (mesh.scale ? mesh.scale.x : 1);
                    h = gp.height * (mesh.scale ? mesh.scale.y : 1);
                    d = gp.depth * (mesh.scale ? mesh.scale.z : 1);
                } else {
                    // fallback: use stored size if available
                    const prev = this.platformBodies.find(pb => pb.mesh === mesh);
                    if (prev && prev.size) { w = prev.size.x; h = prev.size.y; d = prev.size.z; }
                }
            } catch (e) {}

            // use mesh world position and rotation
            const pos = mesh.position.clone();
            const quat = mesh.quaternion.clone();

            // create a new static box body via PhysicsWorld.addBox which returns the body
            const body = this.physics.addBox(new CANNON.Vec3(pos.x, pos.y, pos.z), new CANNON.Vec3(Math.abs(w/2), Math.abs(h/2), Math.abs(d/2)), quat);
            // remember mapping
            mesh.userData.physicsBody = body;
            this.platformBodies.push({ mesh, body, size: new THREE.Vector3(w, h, d) });
        } catch (e) {
            console.warn('Failed to update platform body', e);
        }
    }

    // Tombstones: large level and mechanic functions moved to other modules
    // removed level1() {}
    // removed level2() {}
    // removed level3() {}
    // removed level4() {}
    // removed level5() {}
    // removed level6() {}
    // removed level7() {}
    // removed level8() {}
    // removed level9() {}
    // removed level10() {}
    // removed level11() {}
    // removed level12() {}

    // removed createCheckpoint() {}
    // removed createJumpPad() {}
    // removed createCannon() {}
}

/* End of refactored LevelManager */
