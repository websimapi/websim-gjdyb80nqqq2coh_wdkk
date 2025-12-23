/* checkpoints.js
   Encapsulates checkpoint creation and update animation logic.
*/
import * as THREE from 'three';

export function initCheckpoints(manager) {
    manager.createCheckpoint = function(x,y,z) {
        const group = new THREE.Group();
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.1;
        group.add(pole);

        const flagGeo = new THREE.PlaneGeometry(0.9, 0.6);
        const flagMat = new THREE.MeshStandardMaterial({ color: 0xffff00, side: THREE.DoubleSide });
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(0.45, 1.7, 0);
        group.add(flag);

        // Editor collision box: invisible mesh sized to encompass the flag/pole so editor raycasts hit reliably.
        // Give it userData.isCustom so editor selection logic treats it as a selectable part and won't
        // interfere with gameplay visuals. Also mark with editorCollision for future identification.
        const bboxW = 1.4, bboxH = 2.6, bboxD = 0.8;
        const boxGeo = new THREE.BoxGeometry(bboxW, bboxH, bboxD);
        const boxMat = new THREE.MeshBasicMaterial({ visible: false });
        const collisionBox = new THREE.Mesh(boxGeo, boxMat);
        // position the box so it covers pole + flag area (centered roughly)
        collisionBox.position.set(0.25, 1.2, 0);
        collisionBox.userData = collisionBox.userData || {};
        collisionBox.userData.isCustom = true;           // editor recognizes this as a placeable/selectable object
        collisionBox.userData.editorCollision = true;    // explicit marker for editor tools
        group.add(collisionBox);

        group.position.set(x, y, z);
        group.rotation.order = 'YXZ';
        manager.scene.add(group);
        manager.checkpoints.push({ mesh: group, position: new THREE.Vector3(x, y, z), activated: false });
        return group;
    };
}

export function checkpointUpdate(manager, dt, ballBody) {
    if (!manager.checkpoints) return;
    for (const cp of manager.checkpoints) {
        const d = cp.position.distanceTo(new THREE.Vector3(ballBody.position.x, cp.position.y, ballBody.position.z));
        if (!cp.activated && d < 1.8 && Math.abs(ballBody.position.y - cp.position.y) < 2.5) {
            cp.activated = true;
            const start = performance.now();
            const duration = 600;
            const origColor = cp.mesh.children[1].material.color.clone ? cp.mesh.children[1].material.color.clone() : new THREE.Color(0xffff00);
            const tick = () => {
                const t = Math.min(1, (performance.now() - start) / duration);
                cp.mesh.rotation.y = Math.PI * 2 * t;
                cp.mesh.children[1].material.color.lerpColors(origColor, new THREE.Color(0x44ff44), t);
                cp.mesh.children[1].material.needsUpdate = true;
                if (t < 1) requestAnimationFrame(tick);
            };
            tick();
            try {
                manager.checkpointSound.currentTime = 0;
                manager.checkpointSound.play().catch(()=>{});
            } catch(e){}
            manager.checkpoint.copy(cp.position).add(new THREE.Vector3(0,1,0));
        }
        cp.mesh.rotation.y += dt * (cp.activated ? 2.5 : 0.6);
    }
}

