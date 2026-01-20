import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 1. CONFIGURATION ---
const START_TIME = 90.0;    
const TIME_BONUS = 30.0;    
const BASE_SPEED = 0.15;    
const BIKE_MULTIPLIER = 2.0; 
const DRINK_MULTIPLIER = 1.5; 
const DRINK_DURATION = 15.0;
const POWERUP_SPAWN_RATE = 5.0; 

const MAP_LIMIT = 2000;     

// STATE
let score = 0;
let timeLeft = START_TIME;
let gameActive = true;
let isPaused = false; 
let hasBike = false; 
let drinkTimer = 0.0; 
let isMapOpen = false; 
let spawnTimer = 0; 

// DATA STORE
let validRoadPositions = []; 
let powerups = []; 
let bikeTemplate = null; 
let drinkTemplate = null;

// UI HELPERS
function updateUI() {
    const uiScore = document.getElementById('score');
    const uiTimer = document.getElementById('timer');
    const uiPause = document.getElementById('pause-screen'); 
    const uiGameOver = document.getElementById('game-over');

    if(uiScore) {
        let status = "WALKING";
        if (hasBike && drinkTimer > 0) status = "STACKING IT"; 
        else if (hasBike) status = "ON BIKE";
        else if (drinkTimer > 0) status = "SUGAR RUSH";
        uiScore.innerText = `${score} | ${status}`;
    }

    if(uiTimer) {
        uiTimer.innerText = timeLeft.toFixed(1);
        uiTimer.className = timeLeft < 10 ? "danger" : "highlight";
    }
    
    if(uiPause) uiPause.style.display = isPaused ? "block" : "none";
    if(uiGameOver && !gameActive) uiGameOver.style.display = "block";
}

// --- 2. SCENE ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 20, 20); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.useLegacyLights = false; 
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- 3. LIGHTING (BRIGHT NIGHT CITY) ---
// 1. Hemisphere Light: The main "Street Light" simulator.
// Sky (Deep Blue) -> Ground (Bright Concrete Grey). 
// Intensity 2.5 makes the floor and buildings clearly visible.
const hemiLight = new THREE.HemisphereLight(0x333366, 0x404040, 2.5);
scene.add(hemiLight);

// 2. Ambient Light: The base visibility layer.
// Increased to 1.5 so shadows are never fully black.
const ambientLight = new THREE.AmbientLight(0xccccff, 1.5); 
scene.add(ambientLight);

// 3. Directional Light: The Moon (Casts the shadows)
// We kept the shadows enabled but balanced the light so it's not blinding.
const dirLight = new THREE.DirectionalLight(0xaaccff, 1.2); 
dirLight.position.set(50, 200, 50); 
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096; 
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.bias = -0.0005;
dirLight.shadow.camera.left = -300;
dirLight.shadow.camera.right = 300;
dirLight.shadow.camera.top = 300;
dirLight.shadow.camera.bottom = -300;
scene.add(dirLight);

// --- ENVIRONMENT ---
function initEnvironment() {
    const texLoader = new THREE.TextureLoader();
    texLoader.load('textures/sky.jpg', (texture) => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.background = envMap; 
        texture.dispose();
        pmremGenerator.dispose();
    });

    const fogColor = 0x111122; 
    scene.fog = new THREE.Fog(fogColor, 500, 2500); 

    const floorGeo = new THREE.CircleGeometry(4000, 32);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x050505, 
        roughness: 0.9, 
        metalness: 0.1 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5; 
    floor.receiveShadow = true;
    scene.add(floor);
}

initEnvironment(); 

// --- 4. ASSETS ---
const loader = new GLTFLoader();
const cityGroup = new THREE.Group();
scene.add(cityGroup);

const playerGroup = new THREE.Group();
scene.add(playerGroup);

// --- PLAYER FILL LIGHT ---
// A soft light attached to the player so they are never pitch black
// 0xffffff = White light
// 1.5 = Intensity
// 10 = Distance limit (so it doesn't light up distant buildings)
const playerFillLight = new THREE.PointLight(0xffffff, 1.5, 10);
playerFillLight.position.set(0, 2, 2); // 2m up, 2m forward
playerGroup.add(playerFillLight);

const beaconGroup = new THREE.Group();
scene.add(beaconGroup);

// BEACON
const beaconMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, 80, 16), 
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 })
);
beaconMesh.position.y = 40; 
beaconGroup.add(beaconMesh);

const beaconLight = new THREE.PointLight(0x00ff00, 800, 100);
beaconLight.position.y = 10;
beaconGroup.add(beaconLight);

// ARROW
const arrowMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 }) 
);
arrowMesh.geometry.rotateX(Math.PI / 2); 
arrowMesh.position.y = 6; 
playerGroup.add(arrowMesh);

// MAP LOADER
loader.load('shoreditch.glb', (gltf) => {
    const map = gltf.scene;
    map.scale.set(1.5, 1.5, 1.5);
    
    const box = new THREE.Box3().setFromObject(map);
    const center = box.getCenter(new THREE.Vector3());
    map.position.x += (map.position.x - center.x);
    map.position.z += (map.position.z - center.z);
    map.position.y = -0.2; 

    map.traverse((child) => {
        const name = child.name.toLowerCase();
        const isRoadContainer = name.includes('highway') || name.includes('data') || name.includes('road');

        if (isRoadContainer) {
            let targetMesh = null;
            if (child.isMesh || child.isLine) targetMesh = child;
            else if (child.children.length > 0) {
                 child.traverse((node) => { if (node.isMesh && !targetMesh) targetMesh = node; });
            }

            if (targetMesh) {
                targetMesh.updateWorldMatrix(true, false);
                const matrixWorld = targetMesh.matrixWorld;
                const posAttribute = targetMesh.geometry.attributes.position;
                
                for (let i = 0; i < posAttribute.count; i++) {
                    if (i % 50 !== 0) continue; 
                    const vec = new THREE.Vector3();
                    vec.fromBufferAttribute(posAttribute, i);
                    vec.applyMatrix4(matrixWorld); 
                    if (Math.abs(vec.x) < MAP_LIMIT && Math.abs(vec.z) < MAP_LIMIT) {
                        validRoadPositions.push(new THREE.Vector3(vec.x, 0, vec.z));
                    }
                }
                child.visible = false; 
                child.name = "IGNORE_ME";
                targetMesh.visible = false; 
            }
        } else if (child.isMesh) {
            if (child.name !== "IGNORE_ME") {
                child.castShadow = true;
                child.receiveShadow = true;
                child.name = "CITY_MESH"; 
                if (child.material) {
                    child.material.roughness = 0.9;
                    child.material.metalness = 0.1;
                    child.material.side = THREE.DoubleSide; 
                }
            }
        }
    });
    
    cityGroup.add(map);
    
    if (validRoadPositions.length > 0) {
        const startPos = validRoadPositions[Math.floor(Math.random() * validRoadPositions.length)];
        playerGroup.position.set(startPos.x, 0, startPos.z);
        spawnBeacon();
        spawnPowerup(); 
    } 

}, undefined, (err) => console.error("Map Error:", err));

// --- PLAYER LOADER (UPDATED ANIMATIONS) ---
let playerMesh;
let mixer;
let animationsMap = new Map();
let currentAction;

loader.load('playermodel.glb', (gltf) => {
    playerMesh = gltf.scene;
    playerMesh.scale.set(2.0, 2.0, 2.0); 
    playerMesh.rotation.y = Math.PI; 
    
    playerMesh.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true;
            
            // --- MATERIAL FIX ---
            if (o.material) {
                // 1. Turn off "Mirror Mode" so it actually shows its texture
                o.material.metalness = 0.0; 
                o.material.roughness = 0.8; 
                
                // 2. Ensure the base color is white (so it doesn't darken the texture)
                if (o.material.color) o.material.color.set(0xffffff);
                
                // 3. (Optional) Add a tiny bit of "Inner Glow" if it's still too dark
                // o.material.emissive = new THREE.Color(0x222222); 
            }
        } 
    });

    playerGroup.add(playerMesh);
    
    // ANIMATIONS
    mixer = new THREE.AnimationMixer(playerMesh);
    const clips = gltf.animations;
    console.log("Available Animations:", clips.map(c => c.name));

    const idleClip = THREE.AnimationClip.findByName(clips, 'Idle');
    const runClip = THREE.AnimationClip.findByName(clips, 'Run');
    const jumpClip = THREE.AnimationClip.findByName(clips, 'Jump');
    const punchClip = THREE.AnimationClip.findByName(clips, 'Punch');
    
    if (idleClip) animationsMap.set('Idle', mixer.clipAction(idleClip));
    if (runClip) animationsMap.set('Run', mixer.clipAction(runClip));
    if (jumpClip) animationsMap.set('Jump', mixer.clipAction(jumpClip));
    if (punchClip) animationsMap.set('Punch', mixer.clipAction(punchClip));
    
    currentAction = animationsMap.get('Idle');
    if (currentAction) currentAction.play();

}, undefined, (err) => console.error("Player Model Error:", err));

// --- LOAD LIME BIKE (FIXED LIGHTING) ---
loader.load('limebike.glb', (gltf) => {
    bikeTemplate = gltf.scene;
    bikeTemplate.scale.set(2.5, 2.5, 2.5);
    
    bikeTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true;
            
            // --- MATERIAL FIX ---
            if (o.material) {
                // Remove the "Dark Mirror" effect
                o.material.metalness = 0.0; 
                o.material.roughness = 0.6; // Slightly shiny (like bike paint)
                
                // Reset color to pure white so the texture shows through
                if (o.material.color) o.material.color.set(0xffffff);
            }
        }
    });
    console.log("Lime Bike Loaded!");
}, undefined, (err) => console.error("Bike Load Error:", err));


// --- LOAD MONSTER ENERGY (SCALE 2) ---
loader.load('monster_zero_ultra.glb', (gltf) => {
    drinkTemplate = gltf.scene;
    drinkTemplate.scale.set(0.6, 0.6, 0.6);
    drinkTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
    console.log("Monster Energy Loaded!");
}, undefined, (err) => console.error("Drink Load Error:", err));


// --- 5. LOGIC & SPAWNING ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function canMove(position, direction) {
    const rayStart = position.clone();
    rayStart.y += 1.5; 
    raycaster.set(rayStart, direction);
    
    const validTargets = [];
    cityGroup.traverse(c => {
        if(c.name === "CITY_MESH") validTargets.push(c);
    });

    const intersects = raycaster.intersectObjects(validTargets, false); 

    if (intersects.length > 0) {
        if (intersects[0].distance < 1.5) return false; 
    }
    return true; 
}

// HELPER: Find a valid ground spot using raycasting
function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius) {
    for (let i = 0; i < 20; i++) { // Increased tries to 20 to ensure we find a spot
        let radius = minRadius + Math.random() * (maxRadius - minRadius);
        let angle = Math.random() * Math.PI * 2;
        
        let baseX = centerPos ? centerPos.x : 0;
        let baseZ = centerPos ? centerPos.z : 0;
        
        let testX = baseX + Math.cos(angle) * radius;
        let testZ = baseZ + Math.sin(angle) * radius;
        
        // Quick boundary check
        if (Math.abs(testX) > MAP_LIMIT || Math.abs(testZ) > MAP_LIMIT) continue;

        // RAYCAST CHECK
        raycaster.set(new THREE.Vector3(testX, 100, testZ), downVector);
        
        // STRICT CHECK: We must hit the cityGroup (the 3D model)
        const intersects = raycaster.intersectObjects(cityGroup.children, true);
        
        if (intersects.length > 0) {
            const y = intersects[0].point.y;
            // < 2.0 means ground/pavement. > 2.0 means roof.
            if (y < 2.0) {
                return new THREE.Vector3(testX, 0.5, testZ);
            }
        } 
        
        // PREVIOUSLY: We had an 'else' here that allowed spawning in the void.
        // NOW: We do nothing. If we hit nothing, we loop again.
    }
    return null; // Failed to find a valid spot on the mesh
}

function spawnBeacon() {
    let pos = getAnywhereSpawnPoint(playerGroup.position, 50, 300);
    
    if (pos) {
        beaconGroup.position.copy(pos);
        console.log("New Delivery: Open World Location");
    } else {
        if (validRoadPositions.length > 0) {
             const randomRoad = validRoadPositions[Math.floor(Math.random() * validRoadPositions.length)];
             beaconGroup.position.set(randomRoad.x, 0, randomRoad.z);
             console.log("New Delivery: Road Fallback");
        } else {
             beaconGroup.position.set(playerGroup.position.x + 20, 0, playerGroup.position.z);
        }
    }
}

function spawnPowerup() {
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, MAP_LIMIT * 0.8);

    if (!pos) return;

    const type = Math.random() > 0.5 ? 'bike' : 'drink';
    const group = new THREE.Group();
    group.position.copy(pos);

    if (type === 'bike') {
        if (bikeTemplate) {
            group.add(bikeTemplate.clone());
        } else {
            const chassis = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 0.8, 0.4),
                new THREE.MeshLambertMaterial({ color: 0x32CD32 })
            );
            group.add(chassis);
        }
        group.userData = { type: 'bike', active: true };
    } else {
        if (drinkTemplate) {
            group.add(drinkTemplate.clone());
        } else {
            const can = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8),
                new THREE.MeshLambertMaterial({ color: 0x0000FF }) 
            );
            can.rotation.z = Math.PI / 6; 
            can.position.y = 0.5;
            group.add(can);
        }
        group.userData = { type: 'drink', active: true };
    }
    
    const laser = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,50,0)]),
        new THREE.LineBasicMaterial({ color: 0xFF00FF })
    );
    group.add(laser);

    scene.add(group);
    powerups.push(group);
}


// --- 6. GAME LOOP ---
const keys = { w: false, a: false, s: false, d: false, space: false, k: false };
let cameraAngle = 0;
const cameraRotationSpeed = 0.03;
const currentLookAt = new THREE.Vector3(0, 0, 0);

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === ' ') keys.space = true; // Map Spacebar
    
    if (k === 'p') isPaused = !isPaused;
    if (k === 'm') isMapOpen = !isMapOpen;
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (k === ' ') keys.space = false;
});

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    updateUI();

    if (isPaused) return;

    beaconMesh.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.2;

    if (gameActive) {
        timeLeft -= delta;
        if (drinkTimer > 0) drinkTimer -= delta;
        
        spawnTimer += delta;
        if (spawnTimer > POWERUP_SPAWN_RATE) {
            spawnPowerup();
            spawnTimer = 0;
        }

        if (timeLeft <= 0) {
            timeLeft = 0;
            gameActive = false;
            if (currentAction) currentAction.stop();
        }
    }

    if (gameActive) {
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            p.rotation.y += delta; 
            
            if (p.userData.active && playerGroup.position.distanceTo(p.position) < 2.5) {
                if (p.userData.type === 'bike') {
                    hasBike = true;
                    console.log("COLLECTED: Lime Bike!");
                } else if (p.userData.type === 'drink') {
                    drinkTimer = DRINK_DURATION;
                    console.log("COLLECTED: Monster Energy!");
                }
                
                scene.remove(p);
                p.userData.active = false;
                powerups.splice(i, 1);
            }
        }
    }

    if (playerMesh && mixer) {
        mixer.update(delta);

        if (gameActive && !isMapOpen) {
            
            // --- ACTION HANDLING ---
            let nextActionName = 'Idle';
            let forward = 0;

            // Priority 1: Attacks/Jumps (Visual Only for now)
            if (keys.k && animationsMap.has('Punch')) {
                nextActionName = 'Punch';
            } else if (keys.space && animationsMap.has('Jump')) {
                nextActionName = 'Jump';
            } else {
                // Priority 2: Movement
                if (keys.w) forward = 1;
                if (keys.s) forward = -1;
                
                if (forward !== 0) nextActionName = 'Run';
            }

            // Camera Rotate
            if (keys.a) cameraAngle += cameraRotationSpeed;
            if (keys.d) cameraAngle -= cameraRotationSpeed;

            // Apply Movement
            if (forward !== 0) {
                let currentSpeed = BASE_SPEED;
                if (hasBike) currentSpeed *= BIKE_MULTIPLIER;
                if (drinkTimer > 0) currentSpeed *= DRINK_MULTIPLIER;

                const dirX = Math.sin(cameraAngle);
                const dirZ = Math.cos(cameraAngle);
                const moveVec = new THREE.Vector3(dirX * forward, 0, dirZ * forward).normalize();

                if (canMove(playerGroup.position, moveVec)) {
                    playerGroup.position.x += moveVec.x * currentSpeed;
                    playerGroup.position.z += moveVec.z * currentSpeed;
                }

                // Rotate Character
                const targetRotation = cameraAngle + (forward > 0 ? 0 : Math.PI); 
                let rotDiff = targetRotation - playerMesh.rotation.y;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                playerMesh.rotation.y += rotDiff * 0.1;
            }

            // Play Animation
            const newAction = animationsMap.get(nextActionName);
            if (newAction && currentAction !== newAction) {
                newAction.reset().fadeIn(0.2).play();
                if (currentAction) currentAction.fadeOut(0.2);
                currentAction = newAction;
            }
            
            // Speed up run animation if moving fast
            if (nextActionName === 'Run' && currentAction) {
                let currentSpeed = BASE_SPEED;
                if (hasBike) currentSpeed *= BIKE_MULTIPLIER;
                if (drinkTimer > 0) currentSpeed *= DRINK_MULTIPLIER;
                currentAction.timeScale = (currentSpeed / BASE_SPEED);
            } else if (currentAction) {
                currentAction.timeScale = 1.0;
            }

            arrowMesh.lookAt(beaconGroup.position.x, 4, beaconGroup.position.z);
            
            const dist = playerGroup.position.distanceTo(beaconGroup.position);
            if (dist < 10) { 
                score++;
                timeLeft += TIME_BONUS;
                spawnBeacon();
            }
        }

        let targetPos, targetLook;
        let targetFogNear, targetFogFar;

        if (isMapOpen) {
            targetPos = playerGroup.position.clone().add(new THREE.Vector3(0, 200, 0)); 
            targetLook = playerGroup.position.clone();
            targetFogNear = 150;
            targetFogFar = 800;
            beaconGroup.scale.set(4, 4, 4); 
            arrowMesh.scale.set(4, 4, 4);
        } else {
            const offset = new THREE.Vector3(0, 6, -10).applyAxisAngle(new THREE.Vector3(0,1,0), cameraAngle);
            targetPos = playerGroup.position.clone().add(offset);
            targetLook = playerGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
            targetFogNear = 30;
            targetFogFar = 120;
            beaconGroup.scale.set(1, 1, 1);
            arrowMesh.scale.set(1, 1, 1);
        }

        camera.position.lerp(targetPos, 0.1);
        currentLookAt.lerp(targetLook, 0.1);
        camera.lookAt(currentLookAt);
        
        scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, targetFogNear, 0.05);
        scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, targetFogFar, 0.05);
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- DEBUGGING HELPERS ---
window.debugSpawn = (forcedType) => {
    console.log("Debug Spawn Requested:", forcedType);
    
    const playerPos = playerGroup.position;
    const pos = getAnywhereSpawnPoint(playerPos, 5, 20);

    if (!pos) {
        console.warn("Could not find ground nearby!");
        return;
    }

    const group = new THREE.Group();
    group.position.copy(pos);
    
    if (forcedType === 'bike') {
        if (bikeTemplate) {
            group.add(bikeTemplate.clone());
        } else {
            const chassis = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 0.8, 0.4),
                new THREE.MeshLambertMaterial({ color: 0x32CD32 })
            );
            group.add(chassis);
        }
        group.userData = { type: 'bike', active: true };
    } else {
        if (drinkTemplate) {
            group.add(drinkTemplate.clone());
        } else {
            const can = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8),
                new THREE.MeshLambertMaterial({ color: 0x0000FF }) 
            );
            can.rotation.z = Math.PI / 6; 
            can.position.y = 0.5;
            group.add(can);
        }
        group.userData = { type: 'drink', active: true };
    }
    
    const laser = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,50,0)]),
        new THREE.LineBasicMaterial({ color: 0xFF00FF })
    );
    group.add(laser);

    scene.add(group);
    powerups.push(group);
};