/* jumpPads.js
   Encapsulates jump pad creation and trigger behavior.
*/
import * as THREE from 'three';

export function initJumpPads(manager) {
    manager.createJumpPad = function(x,y,z, dir = new THREE.Vector3(0,0,1), power = 12) {
        const dirNorm = dir.clone().normalize();

        // Visual: a low-profile disc that sits flush on the platform surface
        const topRadius = 0.6;
        const height = 0.08;
        const geo = new THREE.CylinderGeometry(topRadius, topRadius, height, 24);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff66cc, emissive: 0xff66cc, emissiveIntensity: 0.24 });
        const mesh = new THREE.Mesh(geo, mat);

        // Place so top surface sits at y; raise by half the height
        const halfHeight = height / 2;
        mesh.position.set(x, y + halfHeight, z);

        // Lay the disc flat (top face up).
        mesh.rotation.x = 0;

        // Rotate around Y so the visual "forward" of the pad points along dir.
        const yaw = Math.atan2(dirNorm.x, dirNorm.z); // note: atan2(x,z) so yaw 0 -> +Z
        mesh.rotation.y = yaw;

        // Optional subtle marker to indicate direction (small arrow)
        const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.06 });
        const arrowGeo = new THREE.BoxGeometry(0.12, 0.02, 0.3);
        const arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.position.set(0, halfHeight + 0.02, 0.25);
        arrow.rotation.x = 0;
        mesh.add(arrow);

        manager.scene.add(mesh);

        // mark mesh so editor configure can detect
        mesh.userData.isJumpPad = true;
        // store initial runtime config on mesh for editor to modify
        mesh.userData.cfg = { angleDeg: 0, power, straightUp: (dirNorm.x===0 && dirNorm.z===0 && dirNorm.y>0) };

        const storedPos = mesh.position.clone();
        manager.jumppads.push({ mesh, position: storedPos, dir: dirNorm, power });
        return mesh;
    };
}

export function jumpPadsUpdate(manager, dt, ballBody) {
    if (!manager.jumppads) return;
    for (const jp of manager.jumppads) {
        const d = jp.position.distanceTo(new THREE.Vector3(ballBody.position.x, jp.position.y, ballBody.position.z));
        if (d < 1.0 && Math.abs(ballBody.position.y - jp.position.y) < 1.2) {
            const dir = jp.dir.clone().normalize();
            const newVx = dir.x * jp.power;
            const newVz = dir.z * jp.power;
            const desiredVy = dir.y * jp.power;
            const newVy = Math.max(ballBody.velocity.y, desiredVy, jp.power * 0.45);
            ballBody.velocity.set(newVx, newVy, newVz);
        }
    }
}

