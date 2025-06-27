import * as THREE from './libs/three/three.module.js';
import { Stats } from './libs/stats.module.js';
import { VRButton } from './libs/VRButton.js';
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
	constructor() {
		const container = document.createElement('div');
		document.body.appendChild(container);

		this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
		this.camera.position.set(0, 1.6, 0);

		this.dolly = new THREE.Object3D();
		this.dolly.position.set(0, 0, 0);
		this.dolly.add(this.camera);
		this.dummyCam = new THREE.Object3D();
		this.camera.add(this.dummyCam);

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color('#88c0d0'); // Light blue
		this.scene.add(this.dolly);

		const ambient = new THREE.HemisphereLight(0xffffff, 0x888888, 1.0);
		this.scene.add(ambient);

		const light = new THREE.DirectionalLight(0xffffff, 0.8);
		light.position.set(5, 10, 7.5);
		this.scene.add(light);

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(this.renderer.domElement);

		window.addEventListener('resize', this.resize.bind(this));

		this.clock = new THREE.Clock();
		this.keys = {};
		this.proxy = null;

		this.stats = new Stats();
		container.appendChild(this.stats.dom);

		// Keyboard movement setup
		window.addEventListener('keydown', (e) => this.keys[e.key.toLowerCase()] = true);
		window.addEventListener('keyup', (e) => this.keys[e.key.toLowerCase()] = false);

		this.loadScene();
	}

	resize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	loadScene() {
		// Add simple cube
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const material = new THREE.MeshStandardMaterial({ color: 0xff4400 });
		const cube = new THREE.Mesh(geometry, material);
		cube.position.set(0, 1.5, -3);
		this.scene.add(cube);

		this.proxy = cube; // optional for raycasting

		this.setupXR();
	}

	setupXR() {
		this.renderer.xr.enabled = true;
		document.body.appendChild(VRButton.createButton(this.renderer));

		this.controllers = this.buildControllers(this.dolly);
		this.controllers.forEach((controller) => {
			controller.addEventListener('selectstart', () => controller.userData.selectPressed = true);
			controller.addEventListener('selectend', () => controller.userData.selectPressed = false);
		});

		this.renderer.setAnimationLoop(this.render.bind(this));
	}

	buildControllers(parent) {
		const factory = new XRControllerModelFactory();
		const geometry = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(0, 0, -1)
		]);
		const line = new THREE.Line(geometry);
		line.name = 'line';

		const controllers = [];

		for (let i = 0; i <= 1; i++) {
			const controller = this.renderer.xr.getController(i);
			controller.add(line.clone());
			controller.userData.selectPressed = false;
			parent.add(controller);
			controllers.push(controller);

			const grip = this.renderer.xr.getControllerGrip(i);
			grip.add(factory.createControllerModel(grip));
			parent.add(grip);
		}

		return controllers;
	}

	moveDolly(dt) {
		const speed = 2;
		const direction = new THREE.Vector3(0, 0, -1);
		direction.applyQuaternion(this.dolly.quaternion);
		direction.multiplyScalar(dt * speed);
		this.dolly.position.add(direction);
	}

	render() {
		const dt = this.clock.getDelta();

		// Movement (desktop W key)
		if (!this.renderer.xr.isPresenting && (this.keys['w'] || this.keys['arrowup'])) {
			this.moveDolly(dt);
		}

		// Movement in VR (trigger press)
		const moveInVR = this.controllers?.some(c => c.userData.selectPressed);
		if (this.renderer.xr.isPresenting && moveInVR) {
			this.moveDolly(dt);
		}

		this.stats.update();
		this.renderer.render(this.scene, this.camera);
	}
}

export { App };
