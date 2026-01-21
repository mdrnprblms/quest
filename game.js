import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 1. CONFIGURATION ---
const START_TIME = 90.0;    
const TIME_BONUS = 30.0;    

// SPEED TUNING
const BASE_SPEED = 20.0;     // Increased for faster gameplay
const BIKE_MULTIPLIER = 1.8; // Reduced slightly so you don't fly off map
const DRINK_MULTIPLIER = 1.4; 
const DRINK_DURATION = 15.0;
const POWERUP_SPAWN_RATE = 5.0; 

const MAP_LIMIT = 2000;     

// STATE
let score = 0;
let armor = 0;              
let timeLeft = START_TIME;
let gameActive = true;
let isPaused = false; 
let isTimerRunning = true;
let hasBike = false; 
let drinkTimer = 0.0; 
let isMapOpen = false; 
let spawnTimer = 0; 

// PHYSICS STATE
let verticalVelocity = 0;
let isGrounded = true;
let jumpLocked = false;
// Increased Gravity/Jump to match the faster running speed
const GRAVITY = -60.0; 
const JUMP_FORCE = 30.0;    

// DATA STORE
let validRoadPositions = []; 
let colliderMeshes = []; 
let powerups = []; 
let bikeTemplate = null; 
let drinkTemplate = null;
let lionTeeTemplate = null;      
let lionTeeGreyTemplate = null;
let beltTemplate = null;         

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
        
        uiScore.innerText = `${score} | 🛡️ ${armor} | ${status}`;
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.useLegacyLights = false; 
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- 3. LIGHTING ---
const hemiLight = new THREE.HemisphereLight(0x333366, 0x404040, 2.5);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xccccff, 1.5); 
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xaaccff, 1.2); 
dirLight.position.set(50, 200, 50); 
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024; 
dirLight.shadow.mapSize.height = 1024;
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
    scene.fog = new THREE.Fog(fogColor, 200, 1500); 

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
    floor.visible = false; 
    scene.add(floor);
}

initEnvironment(); 

// --- 4. ASSETS ---
const loader = new GLTFLoader();
const cityGroup = new THREE.Group();
scene.add(cityGroup);

const playerGroup = new THREE.Group();
scene.add(playerGroup);

const playerFillLight = new THREE.PointLight(0xffffff, 1.5, 10);
playerFillLight.position.set(0, 2, 2); 
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
    map.scale.set(3, 3, 3);
    
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
                colliderMeshes.push(child);
                if (child.material) {
                    child.material.roughness = 0.9;
                    child.material.metalness = 0.1;
                    child.material.side = THREE.DoubleSide; 
                }
            }
        }
    });
    
    cityGroup.add(map);
    
  // ... inside loader.load, after cityGroup.add(map) ...
    
    // FIX: Force update matrices so raycaster sees the new mesh immediately
    cityGroup.updateMatrixWorld(true);

    // Try to find a spawn point
    let startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 100);
    
    // If getting close failed, try a wider search
    if (!startPos) startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 100, 500);

    if (startPos) {
        playerGroup.position.copy(startPos);
        // FIX: Drop from the sky (add height) to let gravity settle the player naturally
        playerGroup.position.y += 5.0; 
        verticalVelocity = 0; // Reset velocity
    } else {
        // Absolute emergency fallback
        console.error("Could not find spawn point, defaulting to 0,20,0");
        playerGroup.position.set(0, 20, 0); 
    }
    
    spawnBeacon();
    spawnPowerup(); 

}, undefined, (err) => console.error("Map Error:", err));

// --- PLAYER LOADER ---
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
            if (o.material) {
                o.material.metalness = 0.0; 
                o.material.roughness = 0.8; 
                if (o.material.color) o.material.color.set(0xffffff);
            }
        } 
    });

    playerGroup.add(playerMesh);
    
    mixer = new THREE.AnimationMixer(playerMesh);
    const clips = gltf.animations;

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

// --- POWERUP ASSETS ---
loader.load('limebike.glb', (gltf) => {
    bikeTemplate = gltf.scene;
    bikeTemplate.scale.set(2.5, 2.5, 2.5);
    bikeTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true;
            if (o.material) { o.material.metalness = 0.0; o.material.roughness = 0.6; if (o.material.color) o.material.color.set(0xffffff); }
        }
    });
}, undefined, (err) => console.error("Bike Load Error:", err));

loader.load('monster_zero_ultra.glb', (gltf) => {
    drinkTemplate = gltf.scene;
    drinkTemplate.scale.set(0.6, 0.6, 0.6);
    drinkTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
}, undefined, (err) => console.error("Drink Load Error:", err));

loader.load('liontee.glb', (gltf) => {
    lionTeeTemplate = gltf.scene;
    lionTeeTemplate.scale.set(1.5, 1.5, 1.5); 
    lionTeeTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true; 
            if (o.material) { o.material.metalness = 0.0; o.material.roughness = 0.8; if (o.material.color) o.material.color.set(0xffffff); }
        }
    });
}, undefined, (err) => console.error("Lion Tee Error:", err));

loader.load('lionteegrey.glb', (gltf) => {
    lionTeeGreyTemplate = gltf.scene;
    lionTeeGreyTemplate.scale.set(1.5, 1.5, 1.5);
    lionTeeGreyTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true; 
            if (o.material) { o.material.metalness = 0.0; o.material.roughness = 0.8; if (o.material.color) o.material.color.set(0xffffff); }
        }
    });
}, undefined, (err) => console.error("Lion Tee Grey Error:", err));

loader.load('belt.glb', (gltf) => {
    beltTemplate = gltf.scene;
    beltTemplate.scale.set(2.0, 2.0, 2.0); 
    beltTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true; 
            if (o.material) { o.material.metalness = 0.0; o.material.roughness = 0.8; if (o.material.color) o.material.color.set(0xffffff); }
        }
    });
}, undefined, (err) => console.error("Belt Error:", err));


// --- 5. LOGIC & SPAWNING ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function canMove(position, direction) {
    const rayStart = position.clone();
    rayStart.y += 1.5; 
    raycaster.set(rayStart, direction);
    
    // Uses cached collider array
    const intersects = raycaster.intersectObjects(colliderMeshes, false); 

    if (intersects.length > 0) {
        if (intersects[0].distance < 1.5) return false; 
    }
    return true; 
}

function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius) {
    const maxTries = 30; // Increased tries
    
    for (let i = 0; i < maxTries; i++) {
        let radius = minRadius + Math.random() * (maxRadius - minRadius);
        let angle = Math.random() * Math.PI * 2;
        let baseX = centerPos ? centerPos.x : 0;
        let baseZ = centerPos ? centerPos.z : 0;
        let testX = baseX + Math.cos(angle) * radius;
        let testZ = baseZ + Math.sin(angle) * radius;
        
        if (Math.abs(testX) > MAP_LIMIT || Math.abs(testZ) > MAP_LIMIT) continue;

        // FIX: Start raycast from much higher (300) to clear tall buildings
        raycaster.set(new THREE.Vector3(testX, 300, testZ), downVector);
        const intersects = raycaster.intersectObjects(colliderMeshes, false);
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            // Allow a wider range of heights
            if (hit.point.y > -20 && hit.point.y < 50) {
                // Return point slightly above floor (+2.0) to prevent clipping
                return new THREE.Vector3(testX, hit.point.y + 2.0, testZ);
            }
        } 
    }
    // Return NULL if we failed, so the caller knows to try again
    return null; 
}

function spawnBeacon() {
    let pos = getAnywhereSpawnPoint(playerGroup.position, 50, 300);
    
    if (pos) {
        beaconGroup.position.copy(pos);
    } else {
        if (validRoadPositions.length > 0) {
             const randomRoad = validRoadPositions[Math.floor(Math.random() * validRoadPositions.length)];
             beaconGroup.position.set(randomRoad.x, 0, randomRoad.z);
        } else {
             beaconGroup.position.set(playerGroup.position.x + 20, 0, playerGroup.position.z);
        }
    }
}

function spawnPowerup() {
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, MAP_LIMIT * 0.8);
    if (!pos) return;

    const roll = Math.random();
    let type = 'bike';
    if (roll > 0.80) type = 'armor_tee';
    else if (roll > 0.60) type = 'armor_belt';
    else if (roll > 0.30) type = 'drink';

    createPowerupGroup(type, pos);
}

// Helper to avoid duplicate code in Spawn and Debug
function createPowerupGroup(type, pos) {
    const group = new THREE.Group();
    group.position.copy(pos);

    if (type === 'bike') {
        if (bikeTemplate) group.add(bikeTemplate.clone());
        else {
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 0.4), new THREE.MeshLambertMaterial({ color: 0x32CD32 }));
            group.add(chassis);
        }
        group.userData = { type: 'bike', active: true };
    } 
    else if (type === 'drink') {
        if (drinkTemplate) group.add(drinkTemplate.clone());
        else {
            const can = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x0000FF }));
            can.rotation.z = Math.PI / 6; can.position.y = 0.5;
            group.add(can);
        }
        group.userData = { type: 'drink', active: true };
    }
    else if (type === 'armor_tee') {
        const useGrey = Math.random() > 0.5;
        if (useGrey && lionTeeGreyTemplate) group.add(lionTeeGreyTemplate.clone());
        else if (!useGrey && lionTeeTemplate) group.add(lionTeeTemplate.clone());
        else {
            const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.2), new THREE.MeshLambertMaterial({ color: 0xFFD700 }));
            shirt.position.y = 0.5;
            group.add(shirt);
        }
        group.userData = { type: 'armor_tee', active: true };
    }
    else if (type === 'armor_belt') { 
        if (beltTemplate) group.add(beltTemplate.clone());
        else {
            const belt = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 8, 20), new THREE.MeshLambertMaterial({ color: 0x8B4513 }));
            belt.rotation.x = Math.PI / 2; belt.position.y = 0.5;
            group.add(belt);
        }
        group.userData = { type: 'armor_belt', active: true };
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
    
    // FIX: Prevent default browser actions (scrolling/button clicking) for Space
    if (k === ' ') {
        e.preventDefault(); 
    }

    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === ' ') keys.space = true; 
    
    if (k === 'p') isPaused = !isPaused;
    if (k === 'm') isMapOpen = !isMapOpen;
    if (k === 't') {
        isTimerRunning = !isTimerRunning;
        console.log("Timer Running:", isTimerRunning);
    }
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (k === ' ') {
        keys.space = false;
        jumpLocked = false; 
    }
});

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    updateUI();

    if (isPaused) return;

    beaconMesh.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.2;

    if (gameActive) {
        if (isTimerRunning) timeLeft -= delta;
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
                } 
                else if (p.userData.type === 'drink') {
                    drinkTimer = DRINK_DURATION;
                    console.log("COLLECTED: Monster Energy!");
                }
                else if (p.userData.type === 'armor_tee') {
                    armor += 2; 
                    console.log("COLLECTED: Lion Tee! +2 Armor");
                }
                else if (p.userData.type === 'armor_belt') {
                    armor += 1; 
                    console.log("COLLECTED: Belt! +1 Armor");
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
            
            // 1. INPUT
            let forward = 0;
            if (keys.w) forward = 1;
            if (keys.s) forward = -1;
            
            if (keys.a) cameraAngle += cameraRotationSpeed;
            if (keys.d) cameraAngle -= cameraRotationSpeed;

            // 2. JUMP
            if (keys.space && isGrounded && !jumpLocked) {
                verticalVelocity = JUMP_FORCE;
                isGrounded = false;
                jumpLocked = true; 
                
                if (animationsMap.has('Jump')) {
                    const jumpAction = animationsMap.get('Jump');
                    jumpAction.reset().setLoop(THREE.LoopOnce).play();
                    jumpAction.clampWhenFinished = true;
                    
                    // Fixed Animation Speed Logic
                    jumpAction.timeScale = 1.3; 

                    if (currentAction && currentAction !== jumpAction) {
                        currentAction.fadeOut(0.2);
                    }
                    currentAction = jumpAction;
                }
            }

            // 3. MOVEMENT
            if (forward !== 0) {
                let currentSpeed = BASE_SPEED;
                if (hasBike) currentSpeed *= BIKE_MULTIPLIER;
                if (drinkTimer > 0) currentSpeed *= DRINK_MULTIPLIER;

                const dirX = Math.sin(cameraAngle);
                const dirZ = Math.cos(cameraAngle);
                const moveVec = new THREE.Vector3(dirX * forward, 0, dirZ * forward).normalize();

                if (canMove(playerGroup.position, moveVec)) {
                    // DELTA TIME MOVEMENT
                    playerGroup.position.x += moveVec.x * currentSpeed * delta;
                    playerGroup.position.z += moveVec.z * currentSpeed * delta;
                }

                const targetRotation = cameraAngle + (forward > 0 ? 0 : Math.PI); 
                let rotDiff = targetRotation - playerMesh.rotation.y;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                playerMesh.rotation.y += rotDiff * 0.1;
                
                if (isGrounded && currentAction !== animationsMap.get('Run')) {
                    const run = animationsMap.get('Run');
                    if (run) {
                        run.reset().fadeIn(0.2).play();
                        if (currentAction) currentAction.fadeOut(0.2);
                        currentAction = run;
                    }
                }
                
                // SPEED & ANIMATION SYNC FIX
                // We normalize by BASE_SPEED so the animation multiplier stays around 1.0 - 1.5
                if (isGrounded && currentAction === animationsMap.get('Run')) {
                    currentAction.timeScale = (currentSpeed / BASE_SPEED) * 1.2; 
                }

            } else {
                if (isGrounded && currentAction !== animationsMap.get('Idle')) {
                    const idle = animationsMap.get('Idle');
                    if (idle) {
                        idle.reset().fadeIn(0.2).play();
                        if (currentAction) currentAction.fadeOut(0.2);
                        currentAction = idle;
                        currentAction.timeScale = 1.0;
                    }
                }
            }

            // 4. PHYSICS (Gravity)
            verticalVelocity += GRAVITY * delta; 
            playerGroup.position.y += verticalVelocity * delta;

            raycaster.set(playerGroup.position.clone().add(new THREE.Vector3(0, 5, 0)), downVector);
            const groundHits = raycaster.intersectObjects(colliderMeshes, false);

            if (groundHits.length > 0) {
                const hitY = groundHits[0].point.y;
                const distToFloor = playerGroup.position.y - hitY;

                if (verticalVelocity <= 0 && distToFloor < 0.5) {
                    playerGroup.position.y = hitY; 
                    verticalVelocity = 0;
                    isGrounded = true;
                } 
                else if (isGrounded && distToFloor < 1.5) {
                    playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, hitY, 15 * delta);
                    verticalVelocity = 0; 
                }
            }
            
            // NEW CODE: Smart Respawn
            if (playerGroup.position.y < -50) {
                console.log("Player fell out of world. Respawning...");
                
                // Try to find a safe spot near 0,0
                let safeSpot = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 200);
                
                if (safeSpot) {
                    playerGroup.position.copy(safeSpot);
                    playerGroup.position.y += 5.0; // Drop in
                } else {
                    playerGroup.position.set(0, 20, 0); // Emergency float
                }
                
                verticalVelocity = 0;
                isGrounded = false;
            }

            arrowMesh.lookAt(beaconGroup.position.x, 4, beaconGroup.position.z);
            if (playerGroup.position.distanceTo(beaconGroup.position) < 10) { 
                score++;
                timeLeft += TIME_BONUS;
                spawnBeacon();
            }
        }

        // CAMERA
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// DEBUG SPAWN REPAIRED
window.debugSpawn = (forcedType) => {
    // FIX: Un-focus the button so Spacebar doesn't trigger it again
    if (document.activeElement) {
        document.activeElement.blur();
    }

    const playerPos = playerGroup.position;
    const pos = getAnywhereSpawnPoint(playerPos, 5, 20);
    if (!pos) {
        console.warn("No spawn spot found");
        return;
    }
    createPowerupGroup(forcedType, pos);
    console.log("Debug Spawn:", forcedType);
};