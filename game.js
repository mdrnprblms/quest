import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --- LOADING SCREEN ---
const loadingScreen = document.createElement('div');
loadingScreen.id = 'loading-screen';
loadingScreen.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #000; color: #00ff00; display: flex; 
    justify-content: center; align-items: center; 
    font-family: 'Courier New', Courier, monospace; 
    font-size: 30px; font-weight: bold; z-index: 9999;
    flex-direction: column;
`;
loadingScreen.innerHTML = `<div>LOADING MAP...</div><div style="font-size:14px; margin-top:10px; opacity:0.7;">PLEASE WAIT</div>`;
document.body.appendChild(loadingScreen);

// --- CONTROLS ---
let joystickInput = { x: 0, y: 0 };
let joystickManager;

setTimeout(() => {
    const zone = document.getElementById('zone_joystick');
    if (typeof nipplejs !== 'undefined' && zone) {
        joystickManager = nipplejs.create({
            zone: zone, mode: 'static', position: { left: '50%', top: '50%' }, color: 'white', size: 100
        });
        joystickManager.on('move', (evt, data) => { if (data.vector) { joystickInput.y = data.vector.y; joystickInput.x = data.vector.x; } });
        joystickManager.on('end', () => { joystickInput.x = 0; joystickInput.y = 0; });
    }
    const jumpBtn = document.getElementById('mobile-jump');
    if (jumpBtn) {
        jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); keys.space = true; }, { passive: false });
        jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); keys.space = false; jumpLocked = false; }, { passive: false });
    }
}, 500);

// --- CONFIG ---
const START_TIME = 90.0;    
const TIME_BONUS = 30.0;    
const BASE_SPEED = 20.0; 
const BIKE_MULTIPLIER = 1.8; 
const DRINK_MULTIPLIER = 1.4; 
const DRINK_DURATION = 15.0;
const POWERUP_SPAWN_RATE = 5.0; 

const ENEMY_RUN_SPEED = 21.0;      
const ENEMY_WALK_SPEED = 8.0;      
const ENEMY_VISION_DIST = 60.0;    
const ENEMY_HEARING_DIST = 10.0;   
const ENEMY_FOV = 135;             
const ENEMY_CATCH_RADIUS = 3.5; 

const WANTED_LEVEL_1_SCORE = 3; 
const WANTED_LEVEL_2_SCORE = 5; 

// --- STATE ---
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
let isBusted = false;

// --- PHYSICS ---
let verticalVelocity = 0;
let isGrounded = true;
let jumpLocked = false;
const GRAVITY = -60.0;      
const JUMP_FORCE = 30.0;    

// --- DATA ---
let colliderMeshes = []; 
let powerups = []; 
let activeEnemies = [];          

let bikeTemplate, drinkTemplate, lionTeeTemplate, lionTeeGreyTemplate, beltTemplate;
let policeTemplate, policeClips;          

const maps = ['shoreditch.glb', 'archway.glb', 'carnabyst.glb'];
let currentMapIndex = 0;
let currentMapName = maps[0];

// --- UI ---
function updateUI() {
    const uiScore = document.getElementById('score');
    const uiTimer = document.getElementById('timer');
    const uiPause = document.getElementById('pause-screen'); 
    const uiGameOver = document.getElementById('game-over');
    const uiDrink = document.getElementById('status-drink');
    const uiBike = document.getElementById('status-bike');
    const uiDrinkTimer = document.getElementById('drink-timer');
    
    const warningUI = document.getElementById('zone-warning');
    if (warningUI) warningUI.style.display = 'none';

    if(uiScore) {
        let status = "WALKING";
        if (hasBike && drinkTimer > 0) status = "STACKING IT"; 
        else if (hasBike) status = "ON BIKE";
        else if (drinkTimer > 0) status = "SUGAR RUSH";
        
        let wantedStars = "";
        if (score >= WANTED_LEVEL_2_SCORE) wantedStars = "★★";
        else if (score >= WANTED_LEVEL_1_SCORE) wantedStars = "★";
        uiScore.innerText = `${score} | 🛡️ ${armor} | ${status} ${wantedStars}`;
    }
    if(uiTimer) {
        uiTimer.innerText = timeLeft.toFixed(1);
        uiTimer.className = timeLeft < 10 ? "danger" : "highlight";
    }
    if (uiDrink && uiBike) {
        uiBike.style.display = hasBike ? 'block' : 'none';
        if (drinkTimer > 0) {
            uiDrink.style.display = 'block';
            uiDrinkTimer.innerText = drinkTimer.toFixed(1);
        } else {
            uiDrink.style.display = 'none';
        }
    }
    if(uiPause) uiPause.style.display = isPaused ? "block" : "none";
    if(uiGameOver) {
        if (!gameActive) {
            uiGameOver.style.display = "block";
            if (isBusted) {
                uiGameOver.innerText = "BUSTED";
                uiGameOver.style.color = "#0088ff"; 
            } else {
                uiGameOver.innerText = "SHIFT ENDED";
                uiGameOver.style.color = "#ff3333";
            }
        } else {
            uiGameOver.style.display = "none";
        }
    }
}

// --- SCENE ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 20, 20); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0x333366, 0x404040, 2.5);
scene.add(hemiLight);
const ambientLight = new THREE.AmbientLight(0xccccff, 1.5); 
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xaaccff, 1.2); 
dirLight.position.set(50, 200, 50); 
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024; dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.left = -300; dirLight.shadow.camera.right = 300;
dirLight.shadow.camera.top = 300; dirLight.shadow.camera.bottom = -300;
scene.add(dirLight);

// --- ENV ---
function initEnvironment() {
    const texLoader = new THREE.TextureLoader();
    texLoader.load('textures/sky.jpg', (texture) => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.background = envMap; 
        texture.dispose(); pmremGenerator.dispose();
    });
    scene.fog = new THREE.Fog(0x111122, 1500, 3000); 
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4000, 32), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; 
    floor.receiveShadow = true; floor.visible = false; 
    scene.add(floor);
}
initEnvironment(); 

// --- ASSETS ---
const loader = new GLTFLoader();
const cityGroup = new THREE.Group(); scene.add(cityGroup);
const playerGroup = new THREE.Group(); scene.add(playerGroup);
const enemiesGroup = new THREE.Group(); scene.add(enemiesGroup);

const playerFillLight = new THREE.PointLight(0xffffff, 1.5, 10);
playerFillLight.position.set(0, 2, 2); playerGroup.add(playerFillLight);

const beaconGroup = new THREE.Group(); scene.add(beaconGroup);
const beaconMesh = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 80, 16), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 }));
beaconMesh.position.y = 40; beaconGroup.add(beaconMesh);
const beaconLight = new THREE.PointLight(0x00ff00, 800, 100); beaconLight.position.y = 10; beaconGroup.add(beaconLight);

const arrowMesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 }));
arrowMesh.geometry.rotateX(Math.PI / 2); arrowMesh.position.y = 6; playerGroup.add(arrowMesh);

function loadLevel(mapName) {
    document.getElementById('loading-screen').style.display = 'flex';
    
    // Cleanup
    while(cityGroup.children.length > 0){ cityGroup.remove(cityGroup.children[0]); }
    colliderMeshes = [];
    powerups.forEach(p => scene.remove(p)); powerups = [];
    activeEnemies.forEach(e => { enemiesGroup.remove(e.mesh); }); activeEnemies = [];

    loader.load(mapName, (gltf) => {
        try {
            const map = gltf.scene; map.scale.set(3, 3, 3);
            const box = new THREE.Box3().setFromObject(map);
            const center = box.getCenter(new THREE.Vector3());
            map.position.x -= center.x; map.position.z -= center.z; map.position.y = -0.2; 

            map.traverse((child) => {
                if (child.isMesh) {
                    if (child.name.toLowerCase().includes("border")) {
                        child.visible = false; colliderMeshes.push(child);  
                    } else if (child.name !== "IGNORE_ME") {
                        child.castShadow = true; child.receiveShadow = true; child.name = "CITY_MESH"; 
                        colliderMeshes.push(child);
                        if (child.material) { child.material.roughness = 0.9; child.material.metalness = 0.1; child.material.side = THREE.DoubleSide; }
                    }
                }
            });
            cityGroup.add(map);
            cityGroup.updateMatrixWorld(true);
            
            let startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 500, 3000);
            if (!startPos) startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 3000);
            if (startPos) { playerGroup.position.copy(startPos); playerGroup.position.y += 5.0; verticalVelocity = 0; }
            else { playerGroup.position.set(0, 20, 0); }
            
            spawnBeacon();
            spawnPowerup(); 
        } catch(e) { console.error(e); }
        finally { document.getElementById('loading-screen').style.display = 'none'; }
    }, undefined, (err) => {
        console.error(err); alert("Map Error"); document.getElementById('loading-screen').style.display = 'none';
    });
}
loadLevel(currentMapName);

// --- PLAYER LOADER ---
let playerMesh, mixer, animationsMap = new Map(), currentAction;
loader.load('playermodel.glb', (gltf) => {
    playerMesh = gltf.scene; playerMesh.scale.set(2.0, 2.0, 2.0); playerMesh.rotation.y = Math.PI; 
    playerMesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    playerGroup.add(playerMesh);
    mixer = new THREE.AnimationMixer(playerMesh);
    const clips = gltf.animations;
    ['Idle', 'Run', 'Jump'].forEach(name => {
        const clip = THREE.AnimationClip.findByName(clips, name);
        if(clip) animationsMap.set(name, mixer.clipAction(clip));
    });
    currentAction = animationsMap.get('Idle'); if(currentAction) currentAction.play();
});

// --- POLICE LOADER ---
loader.load('police.glb', (gltf) => {
    policeTemplate = gltf.scene;
    policeTemplate.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; 
        } 
    });
    policeClips = gltf.animations;
    console.log("Police Template Loaded");
});

// --- ITEM LOADERS ---
loader.load('limebike.glb', (gltf) => { 
    bikeTemplate = gltf.scene; bikeTemplate.scale.set(2.5, 2.5, 2.5);
    bikeTemplate.traverse(o => { 
        if(o.isMesh && o.material) { 
            o.material.metalness = 0.0; o.material.roughness = 0.8; o.material.emissive = new THREE.Color(0x333333); 
        } 
    });
});
loader.load('monster_zero_ultra.glb', (gltf) => { drinkTemplate = gltf.scene; drinkTemplate.scale.set(0.6, 0.6, 0.6); });
loader.load('liontee.glb', (gltf) => { lionTeeTemplate = gltf.scene; lionTeeTemplate.scale.set(1.5, 1.5, 1.5); });
loader.load('lionteegrey.glb', (gltf) => { lionTeeGreyTemplate = gltf.scene; lionTeeGreyTemplate.scale.set(1.5, 1.5, 1.5); });
loader.load('belt.glb', (gltf) => { beltTemplate = gltf.scene; beltTemplate.scale.set(2.0, 2.0, 2.0); });

// --- UTILS ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function canMove(position, direction) {
    const rayStart = position.clone(); rayStart.y += 1.5; 
    raycaster.set(rayStart, direction);
    const intersects = raycaster.intersectObjects(colliderMeshes, false); 
    return intersects.length === 0 || intersects[0].distance >= 1.5;
}

function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius) {
    for (let i = 0; i < 50; i++) {
        let r = minRadius + Math.random() * (maxRadius - minRadius);
        let a = Math.random() * Math.PI * 2;
        let testX = centerPos.x + Math.cos(a) * r;
        let testZ = centerPos.z + Math.sin(a) * r;
        
        if (Math.abs(testX) > MAP_LIMIT || Math.abs(testZ) > MAP_LIMIT) continue;

        raycaster.set(new THREE.Vector3(testX, 500, testZ), downVector);
        const hits = raycaster.intersectObjects(colliderMeshes, false);
        if (hits.length > 0 && hits[0].point.y > -20 && hits[0].point.y < 50 && hits[0].face.normal.y > 0.5) {
            return new THREE.Vector3(testX, hits[0].point.y + 2.0, testZ);
        } 
    }
    return null; 
}

// --- SPAWNING ---
function spawnBeacon() {
    let pos = getAnywhereSpawnPoint(playerGroup.position, 50, 300);
    if (pos) beaconGroup.position.copy(pos); else beaconGroup.position.set(playerGroup.position.x + 20, 0, playerGroup.position.z);
    updateWantedSystem();
}

function updateWantedSystem() {
    if (!policeTemplate || !policeClips) return;
    let count = 0;
    if (score >= WANTED_LEVEL_2_SCORE) count = 2; else if (score >= WANTED_LEVEL_1_SCORE) count = 1; 
    
    if (activeEnemies.length < count) {
        for (let i = 0; i < count - activeEnemies.length; i++) createNewEnemy();
    }
    activeEnemies.forEach(e => {
        e.isChasing = false; 
        let p = getAnywhereSpawnPoint(beaconGroup.position, 10, 80);
        if (p) e.patrolTarget = p;
    });
}

function createNewEnemy() {
    // USE SKELETON UTILS TO FIX SQUASHING
    const mesh = SkeletonUtils.clone(policeTemplate);
    const mixer = new THREE.AnimationMixer(mesh);
    mesh.scale.set(2.5, 2.5, 2.5); // APPLY SCALE TO CLONE
    mesh.position.y = 0.0; 
    
    enemiesGroup.add(mesh);
    
    let pos = getAnywhereSpawnPoint(beaconGroup.position, 10, 50);
    if (pos) mesh.position.copy(pos); else mesh.position.copy(beaconGroup.position);

    const actions = {};
    const idle = THREE.AnimationClip.findByName(policeClips, 'Idle');
    const run = THREE.AnimationClip.findByName(policeClips, 'Running');
    const fast = THREE.AnimationClip.findByName(policeClips, 'Fast Run');
    const walk = THREE.AnimationClip.findByName(policeClips, 'Walk'); // Check for Walk
    const hook = THREE.AnimationClip.findByName(policeClips, 'Hook');

    if(idle) actions['Idle'] = mixer.clipAction(idle);
    
    // PATROL LOGIC: Prefer 'Walk', fallback to 'Running' (slowed)
    if(walk) {
        actions['Patrol'] = mixer.clipAction(walk);
    } else if(run) { 
        actions['Patrol'] = mixer.clipAction(run); 
        actions['Patrol'].timeScale = 0.5; // Slow down running to look like walking
    }
    
    if(fast) actions['Chase'] = mixer.clipAction(fast); else if(run) actions['Chase'] = mixer.clipAction(run);
    if(hook) actions['Hook'] = mixer.clipAction(hook);

    const curr = actions['Idle'];
    if(curr) curr.play();
    
    // Add light
    const light = new THREE.PointLight(0xff0000, 2, 10);
    light.position.set(0, 2, 0);
    mesh.add(light);

    activeEnemies.push({
        mesh: mesh, mixer: mixer, actions: actions, currentAction: curr,
        state: 'PATROL', patrolTarget: null, patrolTimer: 0
    });
}

function spawnPowerup() {
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 3000);
    if (!pos) return;
    const roll = Math.random();
    let type = 'bike';
    if (roll > 0.80) type = 'armor_tee'; else if (roll > 0.60) type = 'armor_belt'; else if (roll > 0.30) type = 'drink';
    createPowerupGroup(type, pos);
}

function createPowerupGroup(type, pos) {
    const group = new THREE.Group();
    group.position.copy(pos);
    
    if (type === 'bike') {
        if (bikeTemplate) group.add(bikeTemplate.clone());
        else { const m = new THREE.Mesh(new THREE.BoxGeometry(2,1,0.5), new THREE.MeshBasicMaterial({color: 0x32CD32})); group.add(m); }
    } else if (type === 'drink') {
        if (drinkTemplate) group.add(drinkTemplate.clone());
        else { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,0.6), new THREE.MeshBasicMaterial({color: 0x0000ff})); group.add(m); }
    } else if (type === 'armor_tee') {
        if (lionTeeTemplate) group.add(lionTeeTemplate.clone());
        else { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.1), new THREE.MeshBasicMaterial({color: 0xffff00})); group.add(m); }
    } else if (type === 'armor_belt') {
        if (beltTemplate) group.add(beltTemplate.clone());
        else { const m = new THREE.Mesh(new THREE.TorusGeometry(0.3,0.05), new THREE.MeshBasicMaterial({color: 0x8B4513})); group.add(m); }
    }
    
    group.userData = { type: type, active: true };
    const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,50,0)]), new THREE.LineBasicMaterial({ color: 0xFF00FF }));
    group.add(laser);
    scene.add(group);
    powerups.push(group);
}

// --- LOOP ---
const keys = { w: false, a: false, s: false, d: false, space: false };
let cameraAngle = 0; const cameraRotationSpeed = 0.03; const currentLookAt = new THREE.Vector3();

window.addEventListener('keydown', (e) => { if(e.key===' ')e.preventDefault(); keys[e.key.toLowerCase()] = true; if(e.key===' ')keys.space=true; if(e.key==='p')isPaused=!isPaused; if(e.key==='m')isMapOpen=!isMapOpen; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; if(e.key===' ') { keys.space=false; jumpLocked=false; } });

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
        if (spawnTimer > POWERUP_SPAWN_RATE) { spawnPowerup(); spawnTimer = 0; }
        if (timeLeft <= 0) { timeLeft = 0; gameActive = false; if (currentAction) currentAction.stop(); }
    }

    // AI
    if (gameActive) {
        activeEnemies.forEach((enemy) => {
            if (enemy.mixer) enemy.mixer.update(delta);
            const dist = enemy.mesh.position.distanceTo(playerGroup.position);
            
            let detected = false;
            if (dist < ENEMY_HEARING_DIST) detected = true;
            else if (dist < ENEMY_VISION_DIST) {
                const fwd = new THREE.Vector3(0,0,1).applyQuaternion(enemy.mesh.quaternion).normalize();
                const toPlayer = new THREE.Vector3().subVectors(playerGroup.position, enemy.mesh.position).normalize();
                if (THREE.MathUtils.radToDeg(fwd.angleTo(toPlayer)) < (ENEMY_FOV/2)) detected = true;
            }

            if (detected) { enemy.state = 'CHASE'; }
            else if (enemy.state === 'CHASE' && dist > ENEMY_VISION_DIST * 1.5) { enemy.state = 'PATROL'; enemy.patrolTarget = null; }

            if (enemy.state === 'CHASE') {
                enemy.mesh.lookAt(playerGroup.position.x, enemy.mesh.position.y, playerGroup.position.z);
                const dir = new THREE.Vector3().subVectors(playerGroup.position, enemy.mesh.position).normalize();
                enemy.mesh.position.addScaledVector(dir, ENEMY_RUN_SPEED * delta);
                
                if (dist < ENEMY_CATCH_RADIUS) {
                    gameActive = false; isBusted = true; if (currentAction) currentAction.stop();
                    if(enemy.actions['Hook']) { enemy.actions['Hook'].reset().play(); if(enemy.currentAction) enemy.currentAction.stop(); enemy.currentAction=enemy.actions['Hook']; }
                }
                if (enemy.actions['Chase'] && enemy.currentAction !== enemy.actions['Chase']) {
                    enemy.actions['Chase'].reset().play(); if (enemy.currentAction) enemy.currentAction.fadeOut(0.2); enemy.currentAction = enemy.actions['Chase'];
                }
            } else {
                if (!enemy.patrolTarget) {
                    let p = getAnywhereSpawnPoint(enemy.mesh.position, 10, 40);
                    if(p) enemy.patrolTarget = p; enemy.patrolTimer = 0;
                }
                if (enemy.mesh.position.distanceTo(enemy.patrolTarget) < 2) {
                    enemy.patrolTimer += delta;
                    if (enemy.patrolTimer > 2) enemy.patrolTarget = null;
                    if (enemy.actions['Idle'] && enemy.currentAction !== enemy.actions['Idle']) {
                        enemy.actions['Idle'].reset().play(); if (enemy.currentAction) enemy.currentAction.fadeOut(0.2); enemy.currentAction = enemy.actions['Idle'];
                    }
                } else {
                    enemy.mesh.lookAt(enemy.patrolTarget.x, enemy.mesh.position.y, enemy.patrolTarget.z);
                    const dir = new THREE.Vector3().subVectors(enemy.patrolTarget, enemy.mesh.position).normalize();
                    enemy.mesh.position.addScaledVector(dir, ENEMY_WALK_SPEED * delta);
                    if (enemy.actions['Patrol'] && enemy.currentAction !== enemy.actions['Patrol']) {
                        enemy.actions['Patrol'].reset().play(); if (enemy.currentAction) enemy.currentAction.fadeOut(0.2); enemy.currentAction = enemy.actions['Patrol'];
                    }
                }
            }
            raycaster.set(new THREE.Vector3(enemy.mesh.position.x, 300, enemy.mesh.position.z), downVector);
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0) enemy.mesh.position.y = THREE.MathUtils.lerp(enemy.mesh.position.y, hits[0].point.y, 10 * delta);
        });
    }

    // Powerups
    if (gameActive) {
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i]; p.rotation.y += delta;
            if (p.userData.active && playerGroup.position.distanceTo(p.position) < 2.5) {
                if (p.userData.type === 'bike') hasBike = true;
                else if (p.userData.type === 'drink') drinkTimer = DRINK_DURATION;
                else if (p.userData.type.includes('armor')) armor += 1;
                scene.remove(p); p.userData.active = false; powerups.splice(i, 1);
            }
        }
    }

    // Player
    if (playerMesh && mixer) {
        mixer.update(delta);
        if (gameActive && !isMapOpen) {
            let forward = 0;
            if (keys.w) forward = 1; if (keys.s) forward = -1;
            if (Math.abs(joystickInput.y) > 0.1) forward = joystickInput.y > 0 ? 1 : -1;
            if (keys.a) cameraAngle += cameraRotationSpeed; if (keys.d) cameraAngle -= cameraRotationSpeed;
            if (Math.abs(joystickInput.x) > 0.1) cameraAngle -= joystickInput.x * cameraRotationSpeed * 2.0;

            if (keys.space && isGrounded && !jumpLocked) {
                verticalVelocity = JUMP_FORCE; isGrounded = false; jumpLocked = true;
                if(animationsMap.get('Jump')) { animationsMap.get('Jump').reset().setLoop(THREE.LoopOnce).play(); if(currentAction) currentAction.fadeOut(0.2); currentAction = animationsMap.get('Jump'); }
            }

            if (forward !== 0) {
                let spd = BASE_SPEED; if(hasBike) spd *= BIKE_MULTIPLIER; if(drinkTimer > 0) spd *= DRINK_MULTIPLIER;
                const dir = new THREE.Vector3(Math.sin(cameraAngle)*forward, 0, Math.cos(cameraAngle)*forward).normalize();
                if (canMove(playerGroup.position, dir)) playerGroup.position.addScaledVector(dir, spd * delta);
                
                const targetRot = cameraAngle + (forward > 0 ? 0 : Math.PI);
                let diff = targetRot - playerMesh.rotation.y;
                while(diff > Math.PI) diff -= Math.PI*2; while(diff < -Math.PI) diff += Math.PI*2;
                playerMesh.rotation.y += diff * 0.1;

                if (isGrounded && currentAction !== animationsMap.get('Run')) {
                    animationsMap.get('Run').reset().fadeIn(0.2).play(); if(currentAction) currentAction.fadeOut(0.2); currentAction = animationsMap.get('Run');
                }
            } else {
                if (isGrounded && currentAction !== animationsMap.get('Idle')) {
                    animationsMap.get('Idle').reset().fadeIn(0.2).play(); if(currentAction) currentAction.fadeOut(0.2); currentAction = animationsMap.get('Idle');
                }
            }

            verticalVelocity += GRAVITY * delta; 
            playerGroup.position.y += verticalVelocity * delta;
            
            raycaster.set(playerGroup.position.clone().add(new THREE.Vector3(0, 5, 0)), downVector);
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0) {
                const h = hits[0].point.y;
                if (verticalVelocity <= 0 && playerGroup.position.y - h < 0.5) { playerGroup.position.y = h; verticalVelocity = 0; isGrounded = true; }
                else if (isGrounded) playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, h, 15*delta);
            }
            if (playerGroup.position.y < -50) { 
                let s = getAnywhereSpawnPoint(new THREE.Vector3(), 0, 500); 
                if(s) { playerGroup.position.copy(s); playerGroup.position.y+=5; verticalVelocity=0; }
            }

            arrowMesh.lookAt(beaconGroup.position.x, 4, beaconGroup.position.z);
            if (playerGroup.position.distanceTo(beaconGroup.position) < 10) { score++; timeLeft += TIME_BONUS; spawnBeacon(); }
        }

        let offset = new THREE.Vector3(0, 6, -10).applyAxisAngle(new THREE.Vector3(0,1,0), cameraAngle);
        let look = new THREE.Vector3(0, 2, 0);
        let fogNear = 1500, fogFar = 3000;
        
        if (isMapOpen) {
            offset = new THREE.Vector3(0, 200, 0); look = new THREE.Vector3(0,0,0);
            beaconGroup.scale.set(4,4,4); arrowMesh.scale.set(4,4,4);
        } else {
            beaconGroup.scale.set(1,1,1); arrowMesh.scale.set(1,1,1);
        }
        
        camera.position.lerp(playerGroup.position.clone().add(offset), 0.1);
        currentLookAt.lerp(playerGroup.position.clone().add(look), 0.1);
        camera.lookAt(currentLookAt);
        scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, fogNear, 0.05);
        scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, fogFar, 0.05);
    }
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

window.spawnPolice = () => { if(policeTemplate) createNewEnemy(); else console.warn("Wait for police load"); };
window.debugSpawn = (type) => { 
    if(document.activeElement) document.activeElement.blur();
    let p = getAnywhereSpawnPoint(playerGroup.position, 5, 20); 
    if(p) createPowerupGroup(type, p); 
};
window.switchMap = () => {
    currentMapIndex = (currentMapIndex + 1) % maps.length;
    currentMapName = maps[currentMapIndex];
    loadLevel(currentMapName); if(document.activeElement) document.activeElement.blur();
};