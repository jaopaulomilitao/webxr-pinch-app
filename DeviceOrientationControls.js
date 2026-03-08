import * as THREE from 'three';

// a classe de controle baseada em sensores do dispositivo é criada
class DeviceOrientationControls {
    constructor(object) {
        // o objeto 3d (geralmente a camera) é referenciado
        this.object = object;
        
        // a ordem de rotacao é ajustada para o padrao de euler yxz
        this.object.rotation.reorder('YXZ');
        this.enabled = true;
        this.deviceOrientation = {};
        this.screenOrientation = 0;
        this.alphaOffset = 0;

        // o evento de mudanca de orientacao é capturado
        const onDeviceOrientationChangeEvent = (event) => {
            this.deviceOrientation = event;
        };

        // o evento de rotacao de tela (retrato/paisagem) é capturado
        const onScreenOrientationChangeEvent = () => {
            this.screenOrientation = window.orientation || 0;
        };

        // os sensores sao conectados aos eventos do navegador
        this.connect = () => {
            onScreenOrientationChangeEvent();
            window.addEventListener('orientationchange', onScreenOrientationChangeEvent);
            window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent);
            this.enabled = true;
        };

        // os sensores sao desconectados
        this.disconnect = () => {
            window.removeEventListener('orientationchange', onScreenOrientationChangeEvent);
            window.removeEventListener('deviceorientation', onDeviceOrientationChangeEvent);
            this.enabled = false;
        };

        // a matriz de rotacao do objeto é atualizada a cada frame
        this.update = () => {
            if (this.enabled === false) return;
            
            const device = this.deviceOrientation;
            
            if (device !== null && device.alpha !== null) {
                // os valores de euler sao convertidos de graus para radianos
                const alpha = device.alpha ? THREE.MathUtils.degToRad(device.alpha) + this.alphaOffset : 0;
                const beta = device.beta ? THREE.MathUtils.degToRad(device.beta) : 0;
                const gamma = device.gamma ? THREE.MathUtils.degToRad(device.gamma) : 0;
                const orient = this.screenOrientation ? THREE.MathUtils.degToRad(this.screenOrientation) : 0;
                
                // o quaternion final é calculado e aplicado ao objeto
                const setObjectQuaternion = function(quaternion, alpha, beta, gamma, orient) {
                    const zee = new THREE.Vector3(0, 0, 1);
                    const euler = new THREE.Euler();
                    const q0 = new THREE.Quaternion();
                    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
                    
                    euler.set(beta, alpha, -gamma, 'YXZ');
                    quaternion.setFromEuler(euler);
                    quaternion.multiply(q1);
                    quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
                };
                
                setObjectQuaternion(this.object.quaternion, alpha, beta, gamma, orient);
            }
        };

        this.connect();
    }
}

// o modulo de controle é exportado
export { DeviceOrientationControls };