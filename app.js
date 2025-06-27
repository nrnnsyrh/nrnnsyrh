// [IMPORTS – same as before]
import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js'
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
	constructor() {
		const container = document.createElement('div');
		document.body.appendChild(container);

		this.assetsPath = './assets/';
		this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
		this.camera.position.set(0, 1.6, 0);

		const listener = new THREE.AudioListener();
		this.camera.add(listener);

		this.dolly = new THREE.Object3D();
		this.dolly.position.set(0, 0, 10);
		this.dolly.add(this.camera);

		this.dummyCam = new THREE.Object3D();
		this.camera.add(this.dummyCam);

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color('#88c0d0'); // sky blue
		this.scene.add(this.dolly);

		const ambient = new THREE.HemisphereLight(0xffffff, 0xaaaaaa, 0.8);
		this.scene.add(ambient);

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(this.renderer.domElement);

		this.setEnvironment();
		window.addEventListener('resize', this.resize.bind(this));

		this.clock = new THREE.Clock();
		this.workingVec3 = new THREE.Vector3();
		this.workingQuaternion = new THREE.Quaternion();
		this.raycaster = new THREE.Raycaster();

		this.stats = new Stats();
		container.appendChild(this.stats.dom);

		this.loadingBar = new LoadingBar();
		this.loadCollege();

		this.immersive = false;
		this.keys = {}; // for keyboard support

		// Background music
		const bgSound = new THREE.Audio(listener);
		const audioLoader = new THREE.AudioLoader();
		audioLoader.load('./assets/ambient.mp3', (buffer) => {
			bgSound.setBuffer(buffer);
			bgSound.setLoop(true);
			bgSound.setVolume(3);
			this.scene.add(bgSound);

			const startAudio = () => {
				if (!bgSound.isPlaying) bgSound.play();
				window.removeEventListener('click', startAudio);
			};
			window.addEventListener('click', startAudio);
		});

		// Keyboard movement support (WASD)
		window.addEventListener('keydown', (e) => this.keys[e.key.toLowerCase()] = true);
		window.addEventListener('keyup', (e) => this.keys[e.key.toLowerCase()] = false);

		// Load info boards
		fetch('./college.json')
			.then(response => response.json())
			.then(obj => {
				this.boardData = obj;
				this.boardShown = '';
			});
	}

	setEnvironment() {
		const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
		const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
		pmremGenerator.compileEquirectangularShader();
		loader.load('./assets/hdr/venice_sunset_1k.hdr', (texture) => {
			const envMap = pmremGenerator.fromEquirectangular(texture).texture;
			pmremGenerator.dispose();
			this.scene.environment = envMap;
		});
	}

	resize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	loadCollege() {
		const loader = new GLTFLoader().setPath(this.assetsPath);
		const dracoLoader = new DRACOLoader().setDecoderPath('./libs/three/js/draco/');
		loader.setDRACOLoader(dracoLoader);

		loader.load('college.glb', (gltf) => {
			const college = gltf.scene.children[0];
			this.scene.add(college);

			college.traverse((child) => {
				if (child.isMesh) {
					if (child.name.includes("PROXY")) {
						child.material.visible = false;
						this.proxy = child;
					} else if (child.material.name.includes('Glass')) {
						child.material.opacity = 0.1;
						child.material.transparent = true;
					} else if (child.material.name.includes('SkyBox')) {
						const mat = new THREE.MeshBasicMaterial({ map: child.material.map });
						child.material.dispose();
						child.material = mat;
					}
				}
			});

			const door1 = college.getObjectByName("LobbyShop_Door_1");
			const door2 = college.getObjectByName("LobbyShop_Door_2");
			if (door1 && door2) {
				const pos = door1.position.clone().sub(door2.position).multiplyScalar(0.5).add(door2.position);
				const obj = new THREE.Object3D();
				obj.name = "LobbyShop";
				obj.position.copy(pos);
				college.add(obj);
			}

			this.loadingBar.visible = false;
			this.setupXR();
		});
	}

	setupXR() {
		this.renderer.xr.enabled = true;
		document.body.appendChild(VRButton.createButton(this.renderer));

		this.controllers = this.buildControllers(this.dolly);

		const timeoutId = setTimeout(() => {
			this.useGaze = true;
			this.gazeController = new GazeController(this.scene, this.dummyCam);
		}, 2000);

		this.controllers.forEach((controller) => {
			controller.addEventListener('selectstart', () => controller.userData.selectPressed = true);
			controller.addEventListener('selectend', () => controller.userData.selectPressed = false);
			controller.addEventListener('connected', () => clearTimeout(timeoutId));
		});

		const config = {
			panelSize: { height: 0.5 },
			height: 256,
			name: { fontSize: 50, height: 70 },
			info: { position: { top: 70, backgroundColor: "#ccc", fontColor: "#000" } }
		};
		const content = { name: "name", info: "info" };
		this.ui = new CanvasUI(content, config);
		this.scene.add(this.ui.mesh);

		this.renderer.setAnimationLoop(this.render.bind(this));
	}

	buildControllers(parent) {
		const factory = new XRControllerModelFactory();
		const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
		const line = new THREE.Line(geometry);

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
		if (!this.proxy) return;

		const speed = 2;
		let pos = this.dolly.position.clone();
		pos.y += 1;

		const quaternion = this.dolly.quaternion.clone();
		this.dolly.quaternion.copy(this.dummyCam.getWorldQuaternion(this.workingQuaternion));

		const dir = new THREE.Vector3();
		this.dolly.getWorldDirection(dir).negate();
		this.raycaster.set(pos, dir);

		let blocked = false;
		let intersect = this.raycaster.intersectObject(this.proxy);
		if (intersect.length > 0 && intersect[0].distance < 1.3) blocked = true;

		if (!blocked) {
			this.dolly.translateZ(-dt * speed);
			pos = this.dolly.getWorldPosition(new THREE.Vector3());
		}

		this.dolly.quaternion.copy(quaternion);
	}

	render() {
		const dt = this.clock.getDelta();

		// ✅ Movement in VR
		const isInVR = this.renderer.xr.isPresenting;
		const usingGaze = this.useGaze && this.gazeController?.mode === GazeController.Modes.MOVE;
		const selectPressed = this.controllers?.some(c => c.userData.selectPressed);

		if ((isInVR && (selectPressed || usingGaze)) || (!isInVR && (this.keys['w'] || this.keys['arrowup']))) {
			this.moveDolly(dt);
		}

		// Info board logic
		if (this.boardData) {
			const dollyPos = this.dolly.getWorldPosition(new THREE.Vector3());
			let boardFound = false;
			for (const [name, info] of Object.entries(this.boardData)) {
				const obj = this.scene.getObjectByName(name);
				if (obj && dollyPos.distanceTo(obj.position) < 3) {
					if (this.boardShown !== name) this.showInfoboard(name, info, obj.position);
					boardFound = true;
					break;
				}
			}
			if (!boardFound) {
				this.boardShown = '';
				this.ui.visible = false;
			}
		}

		if (this.immersive !== isInVR) {
			this.resize();
			this.immersive = isInVR;
		}

		this.stats.update();
		this.renderer.render(this.scene, this.camera);
	}

	showInfoboard(name, info, pos) {
		this.ui.position.copy(pos).add(new THREE.Vector3(0, 1.3, 0));
		const camPos = this.dummyCam.getWorldPosition(new THREE.Vector3());
		this.ui.updateElement('name', info.name);
		this.ui.updateElement('info', info.info);
		this.ui.update();
		this.ui.lookAt(camPos);
		this.ui.visible = true;
		this.boardShown = name;
	}
}

export { App };
