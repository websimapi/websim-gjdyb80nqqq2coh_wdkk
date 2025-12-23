/* movingPlatforms.js
   Encapsulates kinematic moving platform creation and per-frame updates.
*/
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function initMovingPlatforms(manager) {
    manager.createMovingPlatform = function(x,y,z, w,h,d, color = 0x44aa88, path = null, speed = 0.25, mode = 'move') {
        // visual mesh
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), manager.sceneRenderer.createPlatformMaterial(color));
        mesh.position.set(x,y,z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        manager.scene.add(mesh);
        manager.platforms.push(mesh);

        // physics body (kinematic style: mass 0 and position updated each frame)
        const halfExt = new CANNON.Vec3(Math.abs(w)/2, Math.abs(h)/2, Math.abs(d)/2);
        const shape = new CANNON.Box(halfExt);
        const body = new CANNON.Body({ mass: 0, shape, material: manager.physics.groundMaterial });
        body.position.set(x, y, z);

        // Try to set kinematic type (if supported) so collisions are treated smoothly.
        try {
            body.type = CANNON.Body.KINEMATIC;
        } catch (e) { /* ignore if not available */ }

        // Ensure velocity vector exists for later updates
        body.velocity.set(0,0,0);
        manager.physics.world.addBody(body);

        // store moving platform meta so mechanics.update can animate it
        const mp = {
            mesh,
            body,
            // Normalize path to array of THREE.Vector3; fall back to simple two-point path at the spawn if not provided
            path: (path && path.length >= 2) ? path.map(p => p.clone()) : [new THREE.Vector3(x,y,z), new THREE.Vector3(x,y,z)],
            // speed here is interpreted as speed parameter; interpreted as lerp-rate for move or rad/s for rotate
            speed: Math.max(0.001, speed),
            t: 0,            // interpolation along current segment [0,1]
            index: 0,        // current segment start index
            forward: true,   // direction flag (true => move index->index+1)
            mode: mode       // 'move' or 'rotate'
        };

        // Initialize body and mesh positions to the first path point or initial pos
        const a = mp.path[0] || new THREE.Vector3(x,y,z);
        mp.mesh.position.copy(a);
        mp.body.position.set(a.x, a.y, a.z);

        manager.movingPlatforms.push(mp);
        return mesh;
    };
}

export function movingPlatformsUpdate(manager, dt) {
    if (!manager.movingPlatforms) return;
    for (const mp of manager.movingPlatforms) {
        // ROTATE mode: rotate in place around Y using speed as rad/s
        if (mp.mode === 'rotate') {
            // simple rotation
            mp.mesh.rotation.y += mp.speed * dt;
            // update physics body orientation to match rotation (keep position)
            if (mp.body) {
                try { mp.body.quaternion.setFromEuler(mp.mesh.rotation.x, mp.mesh.rotation.y, mp.mesh.rotation.z, 'XYZ'); } catch(e){}
            }
            continue;
        }

        // MOVE mode: requires at least two path points
        if (!mp.path || mp.path.length < 2) continue;

        // Remember previous position to compute velocity for the physics body
        const prev = mp.body ? new THREE.Vector3().copy(mp.body.position) : mp.mesh.position.clone();

        // Advance interpolation parameter t along the current segment.
        // mp.speed is interpreted as fraction-per-second over a segment; keep previous semantics for movement.
        mp.t += mp.speed * dt * (mp.forward ? 1 : -1);

        // Handle segment transitions without teleporting
        while (mp.t > 1.0) {
            mp.t -= 1.0;
            mp.index = (mp.index + 1) % mp.path.length;
        }
        while (mp.t < 0.0) {
            mp.t += 1.0;
            mp.index = (mp.index - 1 + mp.path.length) % mp.path.length;
        }

        const a = mp.path[mp.index];
        const b = mp.path[(mp.index + 1) % mp.path.length];

        const nx = THREE.MathUtils.lerp(a.x, b.x, mp.t);
        const ny = THREE.MathUtils.lerp(a.y, b.y, mp.t);
        const nz = THREE.MathUtils.lerp(a.z, b.z, mp.t);

        const newPos = new THREE.Vector3(nx, ny, nz);

        // Update visual mesh
        mp.mesh.position.copy(newPos);

        // Update physics body in a kinematic-friendly way
        if (mp.body) {
            const vel = new THREE.Vector3().subVectors(newPos, prev).divideScalar(Math.max(dt, 1e-6));
            mp.body.position.set(newPos.x, newPos.y, newPos.z);

            try { mp.body.type = CANNON.Body.KINEMATIC; } catch(e) {}
            if (mp.body.velocity) {
                mp.body.velocity.set(vel.x, vel.y, vel.z);
            }
            mp.body.quaternion.copy(mp.mesh.quaternion);
        }
    }
}

