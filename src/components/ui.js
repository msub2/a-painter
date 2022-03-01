/* globals AFRAME THREE Utils */
AFRAME.registerComponent('ui', {
  schema: { brightness: { default: 1.0, max: 1.0, min: 0.0 } },
  dependencies: ['ui-raycaster'],

  init: function () {
    const el = this.el;
    const uiEl = this.uiEl = document.createElement('a-entity');
    const rayEl = this.rayEl = document.createElement('a-entity');
    this.closed = true;
    this.isTooltipPaused = false;
    this.colorStack = ['#272727', '#727272', '#FFFFFF', '#24CAFF', '#249F90', '#F2E646', '#EF2D5E'];
    this.bindMethods();
    this.colorHasChanged = true;
    this.highlightMaterials = {};
    this.intersectedObjects = [];
    this.hoveredOffObjects = [];
    this.hoveredOnObjects = [];
    this.pressedObjects = {};
    this.selectedObjects = {};
    this.unpressedObjects = {};
    this.brushButtonsMapping = {};
    this.brushRegexp = /^(?!.*(fg|bg)$)brush[0-9]+/;
    this.colorHistoryRegexp = /^(?!.*(fg|bg)$)colorhistory[0-9]+$/;
    this.hsv = { h: 0.0, s: 0.0, v: 1.0 };
    this.rayAngle = 45;
    this.rayDistance = 0.2;
    this.openMenu = null;
    this.openingMenu = false;
    this.closeMenu = null;
    this.closingMenu = false;
    this.showMessageWindow = null;
    this.showingMessage = false;
    this.time = 0;

    // The cursor is centered in 0,0 to allow scale it easily
    // This is the offset to put it back in its original position on the slider
    this.cursorOffset = new THREE.Vector3(0.06409, 0.01419, -0.10242);

    // UI entity setup
    uiEl.setAttribute('material', {
      color: '#ffffff',
      flatShading: true,
      shader: 'flat',
      transparent: true,
      fog: false,
      src: '#uinormal'
    });
    uiEl.setAttribute('obj-model', 'obj:#uiobj');
    uiEl.setAttribute('position', '0 0.04 -0.15');

    uiEl.setAttribute('scale', '0 0 0');
    uiEl.setAttribute('visible', false);
    uiEl.classList.add('apainter-ui');
    el.appendChild(uiEl);

    // Ray entity setup
    rayEl.setAttribute('line', '');

    el.appendChild(rayEl);

    // Raycaster setup
    el.setAttribute('ui-raycaster', {
      far: this.rayDistance,
      objects: '.apainter-ui',
      rotation: -this.rayAngle
    });

    this.controller = null;

    const self = this;

    el.addEventListener('controllerconnected', function (evt) {
      const controllerName = evt.detail.name;
      self.tooltips = Utils.getTooltips(controllerName);
      self.controller = {
        name: controllerName,
        hand: evt.detail.component.data.hand
      };

      if (controllerName === 'oculus-touch-controls') {
        self.uiEl.setAttribute('rotation', '45 0 0');
        uiEl.setAttribute('position', '0 0.13 -0.08');
        self.rayAngle = 0;
        el.setAttribute('ui-raycaster', {
          rotation: 0
        });
      } else if (controllerName === 'windows-motion-controls') {
        self.rayAngle = 25;
        self.rayDistance = 1;
        el.setAttribute('ui-raycaster', {
          rotation: -30,
          far: self.rayDistance
        });
      }

      if (self.el.isPlaying) {
        self.addToggleEvent();
      }
    });
  },

  initColorWheel: function () {
    const colorWheel = this.objects.hueWheel;

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      #define M_PI2 6.28318530718\n
      uniform float brightness;
      varying vec2 vUv;
      vec3 hsb2rgb(in vec3 c){
          vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
                           0.0, 
                           1.0 );
          rgb = rgb * rgb * (3.0 - 2.0 * rgb);
          return c.z * mix( vec3(1.0), rgb, c.y);
      }
      
      void main() {
        vec2 toCenter = vec2(0.5) - vUv;
        float angle = atan(toCenter.y, toCenter.x);
        float radius = length(toCenter) * 2.0;
        vec3 color = hsb2rgb(vec3((angle / M_PI2) + 0.5, radius, brightness));
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms: { brightness: { type: 'f', value: this.hsv.v } },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader
    });
    colorWheel.material = material;
  },

  bindMethods: function () {
    this.onComponentChanged = this.onComponentChanged.bind(this);
    this.onTriggerChanged = this.onTriggerChanged.bind(this);
    this.onIntersection = this.onIntersection.bind(this);
    this.onIntersected = this.onIntersected.bind(this);
    this.onIntersectionCleared = this.onIntersectionCleared.bind(this);
    this.onIntersectedCleared = this.onIntersectedCleared.bind(this);
    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.onStrokeStarted = this.onStrokeStarted.bind(this);
    this.toggleMenu = this.toggleMenu.bind(this);
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
  },

  tick: function (t, dt) {
    if (!this.closed && this.handEl) {
      this.updateIntersections();
      this.handleHover();
      this.handlePressedButtons();
    }

    // Advance anime.js animations
    if (this.openingMenu) {
      this.time += dt;
      this.openMenu.tick(this.time);
    } else if (this.closingMenu) {
      this.time += dt;
      this.closeMenu.tick(this.time);
    } else if (this.showingMessage) {
      this.time += dt;
      this.showMessageWindow.tick(this.time);
    }
  },

  onTriggerChanged: function (evt) {
    const triggerValue = evt.detail.value;
    this.lastTriggerValue = triggerValue;
    if (evt.detail.value >= 0.25) {
      this.triggeredPressed = true;
    } else {
      this.triggeredPressed = false;
      this.handleButtonUp();
    }
  },

  handleButtonDown: function (object, position) {
    const name = object.name;
    if (this.activeWidget && this.activeWidget !== name) { return; }
    this.activeWidget = name;
    switch (true) {
      case name === 'brightness': {
        this.onBrightnessDown(position);
        break;
      }
      case name === 'brushnext': {
        if (!this.pressedObjects[name]) {
          this.nextPage();
        }
        break;
      }
      case name === 'brushprev': {
        if (!this.pressedObjects[name]) {
          this.previousPage();
        }
        break;
      }
      case name === 'clear': {
        if (!this.pressedObjects[name]) {
          this.el.sceneEl.systems.brush.clear();
          this.playSound('ui_click1');
        }
        break;
      }
      case name === 'copy': {
        if (!this.pressedObjects[name]) {
          this.copyBrush();
          this.playSound('ui_click1');
        }
        break;
      }
      case name === 'hue': {
        this.onHueDown(position);
        break;
      }
      case name === 'save': {
        if (!this.pressedObjects[name]) {
          this.el.sceneEl.systems.painter.upload();
          this.playSound('ui_click1');
        }
        break;
      }
      case name === 'sizebg': {
        this.onBrushSizeBackgroundDown(position);
        break;
      }
      case this.brushRegexp.test(name): {
        this.onBrushDown(name);
        break;
      }
      case this.colorHistoryRegexp.test(name): {
        this.onColorHistoryButtonDown(object);
        break;
      }
      default: {
        this.activeWidget = undefined;
      }
    }
    this.pressedObjects[name] = object;
  },

  copyBrush: function () {
    const brush = this.el.getAttribute('brush');
    this.handEl.setAttribute('brush', 'brush', brush.brush);
    this.handEl.setAttribute('brush', 'color', brush.color);
    this.handEl.setAttribute('brush', 'size', brush.size);
    this.colorHasChanged = true;
  },

  handleButtonUp: function () {
    const pressedObjects = this.pressedObjects;
    const unpressedObjects = this.unpressedObjects;
    this.activeWidget = undefined;
    Object.keys(pressedObjects).forEach(function (key) {
      const buttonName = pressedObjects[key].name;
      switch (true) {
        case buttonName === 'size': {
          // self.onBrushSizeUp();
          break;
        }
        default: {
          break;
        }
      }
      unpressedObjects[buttonName] = pressedObjects[buttonName];
      delete pressedObjects[buttonName];
    });
  },

  handlePressedButtons: function () {
    const self = this;
    if (!this.triggeredPressed) { return; }
    this.hoveredOnObjects.forEach(function triggerAction (button) {
      self.handleButtonDown(button.object, button.point);
    });
  },

  onColorHistoryButtonDown: function (object) {
    const color = object.material.color.getHexString();
    this.handEl.setAttribute('brush', 'color', '#' + color);
    this.playSound('ui_click0', object.name);
  },

  onBrushDown: function (name) {
    const brushName = this.brushButtonsMapping[name];
    if (!brushName) { return; }
    this.selectBrushButton(name);
    this.handEl.setAttribute('brush', 'brush', brushName.toLowerCase());
  },

  selectBrushButton: function (brushName) {
    const object = this.uiEl.getObject3D('mesh').getObjectByName(brushName + 'bg');
    const selectedObjects = this.selectedObjects;
    const selectedBrush = this.selectedBrush;
    if (selectedBrush) {
      if (!this.highlightMaterials[selectedBrush.name]) {
        this.initHighlightMaterial(object);
      }
      selectedBrush.material = this.highlightMaterials[selectedBrush.name].normal;
      delete selectedObjects[selectedBrush.name];
    }
    selectedObjects[object.name] = object;
    this.selectedBrush = object;
    this.playSound('ui_click1', brushName);
  },

  onHueDown: function (position) {
    const hueWheel = this.objects.hueWheel;
    const radius = this.colorWheelSize;
    hueWheel.updateMatrixWorld();
    hueWheel.worldToLocal(position);
    this.objects.hueCursor.position.copy(position);

    const polarPosition = {
      r: Math.sqrt(position.x * position.x + position.z * position.z),
      theta: Math.PI + Math.atan2(-position.z, position.x)
    };
    const angle = ((polarPosition.theta * (180 / Math.PI)) + 180) % 360;
    this.hsv.h = angle / 360;
    this.hsv.s = polarPosition.r / radius;
    this.updateColor();
    this.playSound('ui_click0', 'hue');
  },

  updateColor: function () {
    const rgb = this.hsv2rgb(this.hsv);
    const color = 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')';
    this.handEl.setAttribute('brush', 'color', color);
    this.colorHasChanged = true;
  },

  hsv2rgb: function (hsv) {
    let r, g, b;
    const h = THREE.Math.clamp(hsv.h, 0, 1);
    const s = THREE.Math.clamp(hsv.s, 0, 1);
    const v = hsv.v;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  },

  rgb2hsv: function (r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h;
    const s = (max === 0 ? 0 : d / max);
    const v = max;

    if (arguments.length === 1) { g = r.g; b = r.b; r = r.r; }

    switch (max) {
      case min: h = 0; break;
      case r: h = (g - b) + d * (g < b ? 6 : 0); h /= 6 * d; break;
      case g: h = (b - r) + d * 2; h /= 6 * d; break;
      case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }
    return { h: h, s: s, v: v };
  },

  onBrightnessDown: function (position) {
    const slider = this.objects.brightnessSlider;
    const sliderBoundingBox = slider.geometry.boundingBox;
    const sliderHeight = sliderBoundingBox.max.z - sliderBoundingBox.min.z;
    slider.updateMatrixWorld();
    slider.worldToLocal(position);
    let brightness = 1.0 - (position.z - sliderBoundingBox.min.z) / sliderHeight;
    // remove object border padding
    brightness = THREE.Math.clamp(brightness * 1.29 - 0.12, 0.0, 1.0);
    this.objects.hueWheel.material.uniforms.brightness.value = brightness;
    this.objects.brightnessCursor.rotation.y = brightness * 1.5 - 1.5;
    this.hsv.v = brightness;
    this.updateColor();
    this.playSound('ui_click0', 'brightness');
  },

  onBrushSizeBackgroundDown: function (position) {
    const slider = this.objects.sizeSlider;
    const sliderBoundingBox = slider.geometry.boundingBox;
    const sliderWidth = sliderBoundingBox.max.x - sliderBoundingBox.min.x;
    slider.updateMatrixWorld();
    slider.worldToLocal(position);
    let brushSize = (position.x - sliderBoundingBox.min.x) / sliderWidth;
    brushSize = brushSize * AFRAME.components.brush.schema.size.max;
    this.handEl.setAttribute('brush', 'size', brushSize);
    this.playSound('ui_click0', 'sizebg');
  },

  handleHover: function () {
    this.updateHoverObjects();
    this.updateMaterials();
  },

  updateHoverObjects: function () {
    let intersectedObjects = this.intersectedObjects;
    intersectedObjects = intersectedObjects.filter(function (obj) {
      return obj.object.name !== 'bb' && obj.object.name !== 'msg_save';
    });
    this.hoveredOffObjects = this.hoveredOnObjects.filter(function (obj) {
      return intersectedObjects.indexOf(obj) === -1;
    });
    this.hoveredOnObjects = intersectedObjects;
  },

  updateMaterials: (function () {
    const point = new THREE.Vector3();
    return function () {
      const self = this;
      const pressedObjects = this.pressedObjects;
      const unpressedObjects = this.unpressedObjects;
      const selectedObjects = this.selectedObjects;
      // Remove hover highlights
      this.hoveredOffObjects.forEach(function (obj) {
        const object = obj.object;
        object.material = self.highlightMaterials[object.name].normal;
      });
      // Add highlight to newly intersected objects
      this.hoveredOnObjects.forEach(function (obj) {
        const object = obj.object;
        point.copy(obj.point);
        if (!self.highlightMaterials[object.name]) {
          self.initHighlightMaterial(object);
        }
        // Update ray
        self.handRayEl.object3D.worldToLocal(point);
        self.handRayEl.setAttribute('line', 'end', point);
        object.material = self.highlightMaterials[object.name].hover;
      });
      // Pressed Material
      Object.keys(pressedObjects).forEach(function (key) {
        const object = pressedObjects[key];
        const materials = self.highlightMaterials[object.name];
        object.material = materials.pressed || object.material;
      });
      // Unpressed Material
      Object.keys(unpressedObjects).forEach(function (key) {
        const object = unpressedObjects[key];
        const materials = self.highlightMaterials[object.name];
        object.material = materials.normal;
        delete unpressedObjects[key];
      });
      // Selected material
      Object.keys(selectedObjects).forEach(function (key) {
        const object = selectedObjects[key];
        const materials = self.highlightMaterials[object.name];
        if (!materials) { return; }
        object.material = materials.selected;
      });
    };
  })(),

  addToggleEvent: function () {
    this.el.addEventListener('toggleMenu', this.toggleMenu);
  },

  removeToggleEvent: function () {
    this.el.removeEventListener('toggleMenu', this.toggleMenu);
  },

  play: function () {
    const el = this.el;
    const handEl = this.handEl;
    if (this.controller) {
      this.addToggleEvent();
    }

    el.addEventListener('model-loaded', this.onModelLoaded);
    el.addEventListener('raycaster-intersection', this.onIntersection);
    el.addEventListener('raycaster-intersection-cleared', this.onIntersectionCleared);
    el.addEventListener('raycaster-intersected', this.onIntersected);
    el.addEventListener('raycaster-intersected-cleared', this.onIntersectedCleared);
    if (!handEl) { return; }
    this.addHandListeners();
  },

  pause: function () {
    const el = this.el;
    const handEl = this.handEl;

    if (this.controller) {
      this.removeToggleEvent();
    }

    el.removeEventListener('raycaster-intersection', this.onIntersection);
    el.removeEventListener('raycaster-intersection-cleared', this.onIntersectionCleared);
    el.removeEventListener('raycaster-intersected', this.onIntersected);
    el.removeEventListener('raycaster-intersected-cleared', this.onIntersectedCleared);
    if (!handEl) { return; }
    this.removeHandListeners();
  },

  onModelLoaded: function (evt) {
    const uiEl = this.uiEl;
    let model = uiEl.getObject3D('mesh');
    model = evt.detail.model;
    if (evt.detail.format !== 'obj' || !model.getObjectByName('brightnesscursor')) { return; }

    this.objects = {};
    this.objects.brightnessCursor = model.getObjectByName('brightnesscursor');
    this.objects.brightnessSlider = model.getObjectByName('brightness');
    this.objects.brightnessSlider.geometry.computeBoundingBox();
    this.objects.previousPage = model.getObjectByName('brushprev');
    this.objects.nextPage = model.getObjectByName('brushnext');

    this.objects.hueCursor = model.getObjectByName('huecursor');
    this.objects.hueWheel = model.getObjectByName('hue');
    this.objects.hueWheel.geometry.computeBoundingSphere();
    this.colorWheelSize = this.objects.hueWheel.geometry.boundingSphere.radius;

    this.objects.sizeCursor = model.getObjectByName('size');
    this.objects.sizeCursor.position.copy(this.cursorOffset);
    this.objects.colorHistory = [];
    for (let i = 0; i < 7; i++) {
      this.objects.colorHistory[i] = model.getObjectByName('colorhistory' + i);
    }
    this.objects.currentColor = model.getObjectByName('currentcolor');
    this.objects.sizeSlider = model.getObjectByName('sizebg');
    this.objects.sizeSlider.geometry.computeBoundingBox();
    // Hide bounding box
    model.getObjectByName('bb').material = new THREE.MeshBasicMaterial(
      { color: 0x248f24, alphaTest: 0, visible: false });
    // Hide objects
    const self = this;

    this.messagesMaterial = new THREE.MeshBasicMaterial({ map: null, transparent: true, opacity: 0.0 });
    this.objects.messageSave = model.getObjectByName('msg_save');
    this.objects.messageSave.material = this.messagesMaterial;
    this.objects.messageSave.visible = false;
    this.objects.messageError = model.getObjectByName('msg_error');
    this.objects.messageError.visible = false;
    this.objects.messageError.material = this.messagesMaterial;

    const messagesImageUrl = 'assets/images/messages.png';

    this.el.sceneEl.systems.material.loadTexture(messagesImageUrl, { src: messagesImageUrl }, function (texture) {
      const material = self.messagesMaterial;
      material.map = texture;
      material.needsUpdate = true;
    });

    function showMessage (msgObject) {
      msgObject.visible = true;
      const animObject = { opacity: 0.0 };

      self.showMessageWindow = AFRAME.ANIME.timeline({ duration: 4000 });
      self.showMessageWindow.add({
        targets: animObject,
        opacity: 1,
        duration: 500,
        update: function () {
          self.messagesMaterial.opacity = animObject.opacity;
        }
      });
      self.showMessageWindow.add({
        targets: animObject,
        opacity: 0,
        duration: 500,
        delay: 3000,
        update: function () {
          self.messagesMaterial.opacity = animObject.opacity;
        },
        complete: function () {
          msgObject.visible = false;
          self.showingMessage = false;
          self.time = 0;
        }
      });
      self.showMessageWindow.play();
      self.showingMessage = true;
    }

    this.el.sceneEl.addEventListener('drawing-upload-completed', function (event) {
      showMessage(self.objects.messageSave);
    });
    this.el.sceneEl.addEventListener('drawing-upload-error', function (event) {
      showMessage(self.objects.messageError);
    });

    this.initColorWheel();
    this.initColorHistory();
    this.initBrushesMenu();
    this.setCursorTransparency();
    this.updateColorUI(this.el.getAttribute('brush').color);
    this.updateSizeSlider(this.el.getAttribute('brush').size);
  },

  initBrushesMenu: function () {
    const previousPage = this.objects.previousPage;
    const nextPage = this.objects.nextPage;
    const brushes = Object.keys(AFRAME.BRUSHES);
    this.initHighlightMaterial(nextPage);
    this.initHighlightMaterial(previousPage);
    previousPage.visible = false;
    nextPage.visible = false;
    this.brushesPerPage = 15;
    this.brushesPagesNum = Math.ceil(brushes.length / this.brushesPerPage);
    this.brushesPage = 0;
    this.loadBrushes(this.brushesPage, this.brushesPerPage);
  },

  setCursorTransparency: function () {
    const hueCursor = this.objects.hueCursor;
    const brightnessCursor = this.objects.brightnessCursor;
    const sizeCursor = this.objects.sizeCursor;
    hueCursor.material.alphaTest = 0.5;
    brightnessCursor.material.alphaTest = 0.5;
    sizeCursor.material.alphaTest = 0.5;
    hueCursor.material.transparent = true;
    brightnessCursor.material.transparent = true;
    sizeCursor.material.transparent = true;
  },

  loadBrushes: (function () {
    const brushesMaterials = {};
    return function (page, pageSize) {
      let brush;
      let brushNum = 0;
      const uiEl = this.uiEl.getObject3D('mesh');
      const brushes = Object.keys(AFRAME.BRUSHES);
      let thumbnail;
      let brushIndex;
      const self = this;
      if (page < 0 || page >= this.brushesPagesNum) { return; }
      if (page === 0) {
        this.objects.previousPage.visible = false;
      } else {
        this.objects.previousPage.visible = true;
      }
      if (page === this.brushesPagesNum - 1) {
        this.objects.nextPage.visible = false;
      } else {
        this.objects.nextPage.visible = true;
      }
      for (let i = 0; i < pageSize; i++) {
        brushIndex = page * pageSize + i;
        brush = brushes[brushIndex];
        thumbnail = brush && AFRAME.BRUSHES[brush].prototype.options.thumbnail;
        loadBrush(brush, brushNum, thumbnail);
        brushNum += 1;
      }
      function loadBrush (name, id, thumbnailUrl) {
        const brushName = !name ? undefined : (name.charAt(0).toUpperCase() + name.slice(1)).toLowerCase();
        if (thumbnailUrl && !brushesMaterials[brushName]) {
          self.el.sceneEl.systems.material.loadTexture(thumbnailUrl, { src: thumbnailUrl }, onLoadThumbnail);
          return;
        }
        onLoadThumbnail();
        function onLoadThumbnail (texture) {
          const button = uiEl.getObjectByName('brush' + id);
          self.brushButtonsMapping['brush' + id] = brushName;
          setBrushThumbnail(texture, button);
        }
      }
      function setBrushThumbnail (texture, button) {
        const brushName = self.brushButtonsMapping[button.name];
        const material = brushesMaterials[brushName] || new THREE.MeshBasicMaterial();
        if (texture) {
          material.map = texture;
          material.alphaTest = 0.5;
          material.transparent = true;
        } else if (!brushesMaterials[brushName]) {
          material.visible = false;
        }
        brushesMaterials[brushName] = material;
        self.highlightMaterials[button.name] = {
          normal: material,
          hover: material,
          pressed: material,
          selected: material
        };
        button.material = material;
      }
    };
  })(),

  nextPage: function () {
    if (this.brushesPage >= this.brushesPagesNum - 1) { return; }
    this.brushesPage++;
    this.loadBrushes(this.brushesPage, this.brushesPerPage);
    this.playSound('ui_click1');
  },

  previousPage: function () {
    if (this.brushesPage === 0) { return; }
    this.brushesPage--;
    this.loadBrushes(this.brushesPage, this.brushesPerPage);
    this.playSound('ui_click1');
  },

  initHighlightMaterial: function (object) {
    const buttonName = object.name;
    const isBrushButton = this.brushRegexp.test(buttonName);
    const isHistory = buttonName.indexOf('history') !== -1;
    const isHue = buttonName === 'hue' || buttonName === 'huecursor';
    const materials = {
      normal: object.material,
      hover: object.material,
      pressed: object.material,
      selected: object.material
    };
    if (!isBrushButton && !isHistory && !isHue) {
      materials.normal = object.material;
      materials.hover = object.material.clone();
      materials.hover.map = this.system.hoverTexture;
      materials.selected = object.material.clone();
      materials.selected.map = this.system.pressedTexture;
      materials.pressed = object.material.clone();
      materials.pressed.map = this.system.pressedTexture;
    }
    this.highlightMaterials[buttonName] = materials;
  },

  toggleMenu: function (evt) {
    if (this.closed) {
      this.system.closeAll();
      this.open();
      this.system.opened = this.el;
    } else {
      this.close();
      this.system.opened = undefined;
    }
  },

  open: function () {
    const uiEl = this.uiEl;
    const coords = { x: 0, y: 0, z: 0 };
    if (!this.closed) { return; }
    this.uiEl.setAttribute('visible', true);

    const self = this;
    this.openMenu = AFRAME.ANIME({
      targets: coords,
      x: 1,
      y: 1,
      z: 1,
      duration: 100,
      easing: 'easeOutExpo',
      update: function () {
        uiEl.setAttribute('scale', coords);
      },
      complete: function () {
        self.openingMenu = false;
        self.time = 0;
      }
    });
    this.openMenu.play();
    this.openingMenu = true;

    this.el.setAttribute('brush', 'enabled', false);
    this.rayEl.setAttribute('visible', false);
    this.closed = false;

    if (this.tooltips) {
      const self = this;
      this.tooltips.forEach(function (tooltip) {
        if (tooltip.getAttribute('visible') && uiEl.parentEl.id !== tooltip.parentEl.id) {
          self.isTooltipPaused = true;
          tooltip.setAttribute('visible', false);
        }
      });
    }
    this.playSound('ui_menu');
  },

  updateIntersections: (function () {
    const raycaster = this.raycaster = new THREE.Raycaster();
    return function (evt) {
      this.updateRaycaster(raycaster);
      this.intersectedObjects = raycaster.intersectObjects(this.menuEls, true);
    };
  })(),

  onIntersection: function (evt) {
    const visible = this.closed && this.system.opened;
    if (this.el.components.brush.active) { return; }
    this.rayEl.setAttribute('visible', !!visible);
    this.el.setAttribute('brush', 'enabled', false);
  },

  onIntersected: function (evt) {
    const handEl = evt.detail.el;
    // Remove listeners of previous hand
    if (this.handEl) { this.removeHandListeners(); }
    this.handEl = handEl;
    this.handRayEl = this.handEl.components.ui.rayEl;
    this.menuEls = this.uiEl.object3D.children;
    this.syncUI();
    this.addHandListeners();
  },

  addHandListeners: function () {
    const handEl = this.handEl;
    handEl.addEventListener('componentchanged', this.onComponentChanged);
    handEl.addEventListener('stroke-started', this.onStrokeStarted);
    handEl.addEventListener('triggerchanged', this.onTriggerChanged);
  },

  removeHandListeners: function () {
    const handEl = this.handEl;
    handEl.removeEventListener('componentchanged', this.onComponentChanged);
    handEl.removeEventListener('stroke-started', this.onStrokeStarted);
    handEl.removeEventListener('triggerchanged', this.onTriggerChanged);
  },

  onComponentChanged: function (evt) {
    if (evt.detail.name === 'brush') { this.syncUI(); }
  },

  syncUI: function () {
    if (!this.handEl || !this.objects) { return; }
    const brush = this.handEl.getAttribute('brush');
    this.updateSizeSlider(brush.size);
    this.updateColorUI(brush.color);
    this.updateColorHistory();
    // this.updateBrushSelector(brush.brush);
  },

  initColorHistory: function () {
    let colorHistoryObject;
    const currentColor = this.objects.currentColor;
    for (let i = 0; i < this.objects.colorHistory.length; i++) {
      colorHistoryObject = this.objects.colorHistory[i];
      colorHistoryObject.material = colorHistoryObject.material.clone();
      colorHistoryObject.material.map = this.system.selectedTexture;
    }
    currentColor.material = currentColor.material.clone();
    currentColor.material.map = this.system.selectedTexture;
    this.updateColorHistory();
  },

  updateColorHistory: function () {
    let color = this.handEl && this.handEl.getAttribute('brush').color;
    const colorStack = this.colorStack;
    if (!color) { color = this.el.components.brush.schema.color.default; }
    this.objects.currentColor.material.color.set(color);
    for (let i = 0; i < colorStack.length; i++) {
      color = colorStack[colorStack.length - i - 1];
      this.objects.colorHistory[i].material.color.set(color);
    }
  },

  updateSizeSlider: function (size) {
    const slider = this.objects.sizeSlider;
    const sliderBoundingBox = slider.geometry.boundingBox;
    const cursor = this.objects.sizeCursor;
    const sliderWidth = sliderBoundingBox.max.x - sliderBoundingBox.min.x;
    const normalizedSize = size / AFRAME.components.brush.schema.size.max;
    const positionX = normalizedSize * sliderWidth;
    cursor.position.setX(positionX - this.cursorOffset.x);

    const scale = normalizedSize + 0.3;
    cursor.scale.set(scale, 1, scale);
  },

  updateColorUI: function (color) {
    const colorRGB = new THREE.Color(color);
    const hsv = this.hsv = this.rgb2hsv(colorRGB.r, colorRGB.g, colorRGB.b);
    // Update color wheel
    const angle = hsv.h * 2 * Math.PI;
    const radius = hsv.s * this.colorWheelSize;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    this.objects.hueCursor.position.setX(x);
    this.objects.hueCursor.position.setZ(-y);

    // Update color brightness
    this.objects.hueWheel.material.uniforms.brightness.value = this.hsv.v;
    this.objects.brightnessCursor.rotation.y = this.hsv.v * 1.5 - 1.5;
  },

  updateBrushSelector: function (brush) {
    const self = this;
    const buttons = Object.keys(this.brushButtonsMapping);
    const brushButtonsMapping = this.brushButtonsMapping;
    buttons.forEach(function (id) {
      if (brushButtonsMapping[id] !== brush) { return; }
      self.selectBrushButton(id);
    });
  },

  onIntersectionCleared: function () {
    this.checkMenuIntersections = false;
    this.rayEl.setAttribute('visible', false);
    this.el.setAttribute('brush', 'enabled', true);
  },

  onIntersectedCleared: function (evt) {
    if (!this.handEl) { return; }
    this.handEl.removeEventListener('triggerchanged', this.onTriggerChanged);
  },

  onStrokeStarted: function () {
    if (!this.colorHasChanged) { return; }
    const color = this.handEl.getAttribute('brush').color;
    const colorStack = this.colorStack;
    this.colorHasChanged = false;
    if (colorStack.length === 7) { colorStack.shift(); }
    colorStack.push(color);
    this.syncUI();
  },

  updateRaycaster: (function () {
    const direction = new THREE.Vector3();
    const directionHelper = new THREE.Quaternion();
    const scaleDummy = new THREE.Vector3();
    const originVec3 = new THREE.Vector3();

    // Closure to make quaternion/vector3 objects private.
    return function (raycaster) {
      const object3D = this.handEl.object3D;

      // Update matrix world.
      object3D.updateMatrixWorld();
      // Grab the position and rotation.
      object3D.matrixWorld.decompose(originVec3, directionHelper, scaleDummy);
      // Apply rotation to a 0, 0, -1 vector.
      direction.set(0, 0, -1);
      direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), -(this.rayAngle / 360) * 2 * Math.PI);
      direction.applyQuaternion(directionHelper);
      raycaster.far = this.rayDistance;
      raycaster.set(originVec3, direction);
    };
  })(),

  close: function () {
    const uiEl = this.uiEl;
    const coords = { x: 1, y: 1, z: 1 };
    if (this.closed) { return; }

    const self = this;
    this.closeMenu = AFRAME.ANIME({
      targets: coords,
      x: 0,
      y: 0,
      z: 0,
      duration: 100,
      easing: 'easeOutExpo',
      update: function () {
        uiEl.setAttribute('scale', coords);
      },
      complete: function () {
        uiEl.setAttribute('visible', false);
        self.closingMenu = false;
        self.time = 0;
      }
    });
    this.closeMenu.play();
    this.el.setAttribute('brush', 'enabled', true);
    this.closed = true;
    this.closingMenu = true;

    if (this.tooltips && this.isTooltipPaused) {
      this.isTooltipPaused = false;
      this.tooltips.forEach(function (tooltip) {
        tooltip.setAttribute('visible', true);
      });
    }
    this.playSound('ui_menu');
  },

  playSound: function (sound, objName) {
    if (objName === undefined || !this.pressedObjects[objName]) {
      document.getElementById(sound).play();
    }
  }
});
