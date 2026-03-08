import * as THREE from 'three';
import { Hands } from '@mediapipe/hands';
import { score } from './pinch_model.js';

// as variaveis globais e estado da aplicacao sao definidas
let isProcessingFrame = false;
let currentFacingMode = 'environment';

// os arrays de estado armazenam os dados
let isPinchingList = [false, false];

// o controle de objeto selecionado substitui os booleanos simples
let grabbedObject = null;
let hoveredObject = null;

// as variaveis de estado para escala sao criadas
let isScaling = false;
let initialPinchDistance = 0;
let initialObjectScale = new THREE.Vector3();

// os elementos do dom sao recuperados
const videoElement = document.getElementById('background_video');
const toggleCameraButton = document.getElementById('camera_toggle_btn');
const gestureStatusText = document.getElementById('gesture_status');

// a arquitetura basica do threejs é montada
const scene = new THREE.Scene();

// o fov é reduzido de 70 para 45 para diminuir a distorcao das bordas
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 20);
scene.add(camera);

// o renderizador é configurado com mapeamento de sombras suaves
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // as sombras realistas sao ativadas
document.body.appendChild(renderer.domElement);

// a luz ambiente suave é adicionada para nao escurecer tudo
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

// a lista de objetos iterativos é inicializada
const interactiveObjects = [];

// as geometrias e materiais base para os cubos sao instanciadas
const cubeGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
const cubeColors = [0xdd3333, 0x33dd33, 0x3333dd]; // vermelho, verde, azul

// os 3 cubos sao gerados no laco
cubeColors.forEach((color, index) => {
    // o material padrao reage a luz e projecao
    const material = new THREE.MeshStandardMaterial({ 
        color: color, 
        roughness: 0.2, 
        metalness: 0.1 
    });
    
    const cube = new THREE.Mesh(cubeGeometry, material);
    cube.castShadow = true;
    cube.receiveShadow = true;
    
    // as posicoes sao distribuidas horizontalmente
    cube.position.set(-0.15 + (index * 0.15), 0.1, -0.6);
    
    camera.add(cube);
    interactiveObjects.push(cube);
});

// a esfera com luz emissiva é montada
const sphereGeo = new THREE.SphereGeometry(0.04, 16, 16);
const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xffddaa,
    emissive: 0xffaa00,
    emissiveIntensity: 1.0
});
const lightSphere = new THREE.Mesh(sphereGeo, sphereMat);

// a esfera é posicionada ACIMA dos cubos (y: 0.35) para que a luz projete as sombras para baixo
lightSphere.position.set(0, 0.15, -0.6);
lightSphere.castShadow = false; // objetos emissores nao geram sombra propria

// a luz puntual (lampada) é atrelada a esfera
const pointLight = new THREE.PointLight(0xffaa00, 2.0, 3.0);
pointLight.castShadow = true;
pointLight.shadow.mapSize.width = 1024;
pointLight.shadow.mapSize.height = 1024;
pointLight.shadow.bias = -0.001; // o acne de sombra é corrigido
lightSphere.add(pointLight);

// o efeito fake bloom é anexado a esfera via blend mode
const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), glowMat);
lightSphere.add(glowMesh);

camera.add(lightSphere);
interactiveObjects.push(lightSphere);

// o plano visivel (chao branco) é criado para captar as sombras
const shadowPlaneGeo = new THREE.PlaneGeometry(2, 2);
const shadowPlaneMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffff, // cor branca solida
    roughness: 0.8,
    metalness: 0.1,
    opacity: 0.6,
    transparent: true
}); 
const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.set(0, -0.1, -0.6); // este é o "chao" virtual
shadowPlane.receiveShadow = true;
camera.add(shadowPlane);

// a malha visual de debug (grid) no chao
const gridHelper = new THREE.GridHelper(1, 10, 0x000000, 0x444444); // cor ajustada para contrastar com o branco
gridHelper.position.set(0, -0.099, -0.6); // levemente acima do plano para evitar z-fighting
camera.add(gridHelper);

// a estrutura do esqueleto bimanual é instanciada
const handGroup = new THREE.Group();
const handsVisuals = [[], []]; 
const jointGeometry = new THREE.BoxGeometry(0.012, 0.012, 0.012);
const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });

for (let h = 0; h < 2; h++) {
    for (let i = 0; i < 21; i++) {
        const jointMesh = new THREE.Mesh(jointGeometry, jointMaterial);
        jointMesh.visible = false;
        handsVisuals[h].push(jointMesh);
        handGroup.add(jointMesh);
    }
}
camera.add(handGroup);

// o gerenciador da camera do dispositivo é implementado
const startCamera = async () => {
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: 1280, height: 720 }
        });
        videoElement.srcObject = stream;
        
        const isSelfie = currentFacingMode === 'user';
        videoElement.style.transform = isSelfie ? 'scaleX(-1)' : 'scaleX(1)';
        renderer.domElement.style.transform = isSelfie ? 'scaleX(-1)' : 'scaleX(1)';
    } catch (error) {
        console.error('falha ao iniciar camera:', error);
    }
};

toggleCameraButton.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

startCamera();

// a matematica da feature
const calculateNormalizedDistance = (landmarks) => {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    const pinchDistance = Math.hypot(
        thumbTip.x - indexTip.x,
        thumbTip.y - indexTip.y,
        thumbTip.z - indexTip.z
    );

    const handSize = Math.hypot(
        wrist.x - middleMcp.x,
        wrist.y - middleMcp.y,
        wrist.z - middleMcp.z
    );

    return handSize > 0 ? pinchDistance / handSize : 0;
};

// as coordenadas sao projetadas no frustum
const updateHandVisuals = (landmarks, handIndex) => {
    const baseDepth = 0.5;
    const vFov = (camera.fov * Math.PI) / 180;
    const frustumHeight = 2 * Math.tan(vFov / 2) * baseDepth;
    const frustumWidth = frustumHeight * camera.aspect;

    landmarks.forEach((landmark, i) => {
        const jointMesh = handsVisuals[handIndex][i];
        jointMesh.visible = true;
        
        jointMesh.position.x = (landmark.x - 0.5) * frustumWidth;
        jointMesh.position.y = -(landmark.y - 0.5) * frustumHeight;
        jointMesh.position.z = -baseDepth + (landmark.z * frustumWidth);
    });
};

// a inferencia ml é roteada
const onHandTrackingResults = (results) => {
    handsVisuals[0].forEach(joint => joint.visible = false);
    handsVisuals[1].forEach(joint => joint.visible = false);
    
    isPinchingList = [false, false];

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        
        results.multiHandLandmarks.forEach((landmarks, rawIndex) => {
            const handedness = results.multiHandedness[rawIndex].label;
            const consistentIndex = handedness === 'Left' ? 0 : 1;
            
            updateHandVisuals(landmarks, consistentIndex);

            const featureValue = calculateNormalizedDistance(landmarks);
            const predictionScores = score([featureValue]);
            
            isPinchingList[consistentIndex] = predictionScores[1] > 0.5;
        });
        
        const anyPinching = isPinchingList.includes(true);
        gestureStatusText.innerText = anyPinching ? "Pinch!" : "Open";
        gestureStatusText.style.color = anyPinching ? "#00ff00" : "#ffffff";
    } else {
        grabbedObject = null;
        gestureStatusText.innerText = "None";
        gestureStatusText.style.color = "#aaaaaa";
    }
    
    isProcessingFrame = false;
};

// o objeto da rede neural leve do google é instanciado
const handsDetector = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

handsDetector.setOptions({
    maxNumHands: 2, 
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
handsDetector.onResults(onHandTrackingResults);

// o motor principal
const renderLoop = async () => {
    requestAnimationFrame(renderLoop);
    
    if (videoElement.readyState >= 2 && !isProcessingFrame) {
        isProcessingFrame = true;
        await handsDetector.send({ image: videoElement });
    }

    const moveHandIndex = 0; // a mao esquerda move
    const scaleHandIndex = 1; // a mao direita escala

    const moveIndexTip = handsVisuals[moveHandIndex][8];
    const moveThumbTip = handsVisuals[moveHandIndex][4];

    const scaleIndexTip = handsVisuals[scaleHandIndex][8];
    const scaleThumbTip = handsVisuals[scaleHandIndex][4];

    let isTouchingAny = false;
    hoveredObject = null;

    // 1. o laco identifica o objeto mais proximo da mao esquerda
    if (moveIndexTip.visible && moveThumbTip.visible) {
        const pinchCenter = new THREE.Vector3().addVectors(moveIndexTip.position, moveThumbTip.position).multiplyScalar(0.5);
        
        let minDistance = Infinity;

        interactiveObjects.forEach(obj => {
            const distanceToObj = pinchCenter.distanceTo(obj.position);
            // a colisao dinamicamente respeita a escala base do objeto atual
            const grabThreshold = 0.08 * obj.scale.x; 

            if (distanceToObj < grabThreshold && distanceToObj < minDistance) {
                minDistance = distanceToObj;
                hoveredObject = obj;
            }
        });

        if (hoveredObject) isTouchingAny = true;

        // a interacao de posse do objeto é avaliada
        if (isPinchingList[moveHandIndex] && hoveredObject && !grabbedObject) {
            grabbedObject = hoveredObject;
        } else if (!isPinchingList[moveHandIndex]) {
            grabbedObject = null;
        }
        
        // a translacao é aplicada ao item atual
        if (grabbedObject) {
            grabbedObject.position.copy(pinchCenter);
        }
    } else {
        grabbedObject = null;
    }

    // 2. o motor de escala calcula a proporcao na mao direita
    if (grabbedObject && scaleIndexTip.visible && scaleThumbTip.visible) {
        const rawPinchDistance = scaleIndexTip.position.distanceTo(scaleThumbTip.position);
        
        if (!isScaling) {
            isScaling = true;
            initialPinchDistance = rawPinchDistance;
            // a escala e fixada como vetor para evitar perdas
            initialObjectScale.copy(grabbedObject.scale);
        }

        if (initialPinchDistance > 0.01) {
            const scaleFactor = rawPinchDistance / initialPinchDistance;
            
            // a nova escala é multiplicada a partir do tamanho local do objeto
            const newScaleVal = Math.max(0.2, Math.min(initialObjectScale.x * scaleFactor, 4.0));
            grabbedObject.scale.set(newScaleVal, newScaleVal, newScaleVal);
        }
    } else {
        isScaling = false;
    }

    // 3. o feedback de cor é renderizado via emissao para preservar as cores dos materiais
    interactiveObjects.forEach(obj => {
        // o tom do material emissivo é manipulado sem destruir a cor primaria
        if (obj === grabbedObject) {
            obj.material.emissive.setHex(isScaling ? 0x005555 : 0x005500); 
        } else if (obj === hoveredObject && !grabbedObject) {
            obj.material.emissive.setHex(0x333300); // feedback de hover
        } else {
            // as cores originais sao devolvidas a cena
            obj.material.emissive.setHex(obj === lightSphere ? 0xffaa00 : 0x000000);
        }
    });

    renderer.render(scene, camera);
};

renderLoop();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});