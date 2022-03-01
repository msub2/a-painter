/* globals AFRAME THREE Utils */
AFRAME.registerSystem('paint-controls', {
  numberStrokes: 0
});

AFRAME.registerComponent('paint-controls', {
  dependencies: ['brush'],

  schema: {
    hand: { default: 'left' }
  },

  init: function () {
    const el = this.el;
    const self = this;
    const highLightTextureUrl = 'assets/images/controller-pressed.png';
    let tooltips = null;
    this.controller = null;
    this.modelLoaded = false;

    this.onModelLoaded = this.onModelLoaded.bind(this);
    el.addEventListener('model-loaded', this.onModelLoaded);

    el.addEventListener('changeBrushSizeAbs', function (evt) {
      if (evt.detail.axis[1] === 0 && evt.detail.axis[3] === 0) { return; }

      const magnitude = evt.detail.axis[1] || evt.detail.axis[3];
      const delta = magnitude / 300;
      const size = el.components.brush.schema.size;
      const value = THREE.Math.clamp(self.el.getAttribute('brush').size - delta, size.min, size.max);

      self.el.setAttribute('brush', 'size', value);
    });

    el.addEventListener('changeBrushSizeInc', function (evt) {
      if (evt.detail.axis[1] === 0 && evt.detail.axis[3] === 0) { return; }

      const magnitude = evt.detail.axis[1] || evt.detail.axis[3];

      if (self.touchStarted) {
        self.touchStarted = false;
        self.startAxis = (magnitude + 1) / 2;
      }

      const currentAxis = (magnitude + 1) / 2;
      const delta = (self.startAxis - currentAxis) / 2;

      self.startAxis = currentAxis;

      const startValue = self.el.getAttribute('brush').size;
      const size = el.components.brush.schema.size;
      const value = THREE.Math.clamp(startValue - delta, size.min, size.max);

      self.el.setAttribute('brush', 'size', value);
    });

    self.touchStarted = false;

    el.addEventListener('startChangeBrushSize', function () {
      self.touchStarted = true;
    });

    el.addEventListener('controllerconnected', function (evt) {
      let controllerName = evt.detail.name;
      if (controllerName === 'windows-motion-controls') {
        const gltfName = evt.detail.component.el.components['gltf-model'].data;
        const SAMSUNG_DEVICE = '045E-065D';
        if (gltfName) {
          if (gltfName.indexOf(SAMSUNG_DEVICE) >= 0) {
            controllerName = 'windows-motion-samsung-controls';
          }
        }
      }

      tooltips = Utils.getTooltips(controllerName);
      if (controllerName.indexOf('windows-motion') >= 0) {
        // el.setAttribute('teleport-controls', {button: 'trackpad'});
      } else if (controllerName === 'oculus-touch-controls') {
        const hand = evt.detail.component.data.hand;
        // el.setAttribute('teleport-controls', {button: hand === 'left' ? 'ybutton' : 'bbutton'});
        el.setAttribute('obj-model', { obj: 'assets/models/oculus-' + hand + '-controller.obj', mtl: 'https://cdn.aframe.io/controllers/oculus/oculus-touch-controller-' + hand + '.mtl' });
      } else if (controllerName === 'vive-controls') {
        el.setAttribute('json-model', { src: 'assets/models/controller_vive.json' });
      } else { return; }

      if (tooltips) {
        tooltips.forEach(function (tooltip) {
          tooltip.setAttribute('visible', true);
        });
      }

      this.controller = controllerName;
    });

    el.addEventListener('brushsize-changed', function (evt) { self.changeBrushSize(evt.detail.size); });
    el.addEventListener('brushcolor-changed', function (evt) { self.changeBrushColor(evt.detail.color); });

    function createTexture (texture) {
      const material = self.highLightMaterial = new THREE.MeshBasicMaterial();
      material.map = texture;
      material.needsUpdate = true;
    }
    el.sceneEl.systems.material.loadTexture(highLightTextureUrl, { src: highLightTextureUrl }, createTexture);

    this.startAxis = 0;

    this.numberStrokes = 0;
    this.hideTooltips = null;
    this.hidingTooltips = false;
    this.time = 0;

    document.addEventListener('stroke-started', function (event) {
      if (event.detail.entity.components['paint-controls'] !== self) { return; }

      self.numberStrokes++;
      self.system.numberStrokes++;

      // 3 Strokes to hide
      if (self.system.numberStrokes === 3) {
        const tooltips = Array.prototype.slice.call(document.querySelectorAll('[tooltip]'));
        const animObject = { opacity: 1.0 };

        self.hideTooltips = AFRAME.ANIME({
          targets: animObject,
          opacity: 0,
          duration: 1000,
          delay: 2000,
          update: function () {
            tooltips.forEach(function (tooltip) {
              tooltip.setAttribute('tooltip', { opacity: animObject.opacity });
            });
          },
          complete: function () {
            tooltips.forEach(function (tooltip) {
              tooltip.setAttribute('visible', false);
            });
            this.hidingTooltips = false;
          }
        });
        self.hideTooltips.play();
        self.hidingTooltips = true;
      }
    });
  },

  changeBrushColor: function (color) {
    if (this.modelLoaded && !!this.buttonMeshes.sizeHint) {
      this.buttonMeshes.colorTip.material.color.copy(color);
      this.buttonMeshes.sizeHint.material.color.copy(color);
    }
  },

  changeBrushSize: function (size) {
    const scale = size / 2 * 10;
    if (this.modelLoaded && !!this.buttonMeshes.sizeHint) {
      this.buttonMeshes.sizeHint.scale.set(scale, scale, 1);
    }
  },

  // buttonId
  // 0 - trackpad
  // 1 - trigger ( intensity value from 0.5 to 1 )
  // 2 - grip
  // 3 - menu ( dispatch but better for menu options )
  // 4 - system ( never dispatched on this layer )
  mapping: {
    axis0: 'trackpad',
    axis1: 'trackpad',
    button0: 'trackpad',
    button1: 'trigger',
    button2: 'grip',
    button3: 'menu',
    button4: 'system'
  },

  update: function () {
    const data = this.data;
    const el = this.el;
    el.setAttribute('vive-controls', { hand: data.hand, model: false });
    el.setAttribute('oculus-touch-controls', { hand: data.hand, model: false });
    el.setAttribute('windows-motion-controls', { hand: data.hand });
  },

  tick: function (t, dt) {
    if (this.hidingTooltips) {
      this.time += dt;
      this.hideTooltips.tick(this.time);
    }
  },

  play: function () {
  },

  pause: function () {
  },

  onModelLoaded: function (evt) {
    if (evt.target !== this.el) { return; }

    const controllerObject3D = evt.detail.model;
    const buttonMeshes = this.buttonMeshes = {};

    buttonMeshes.sizeHint = controllerObject3D.getObjectByName('sizehint');
    buttonMeshes.colorTip = controllerObject3D.getObjectByName('tip');

    this.modelLoaded = true;

    this.changeBrushSize(this.el.components.brush.data.size);
    this.changeBrushColor(this.el.components.brush.color);
  },

  onButtonEvent: function (id, evtName) {
    const buttonName = this.mapping['button' + id];
    this.el.emit(buttonName + evtName);
    this.updateModel(buttonName, evtName);
  },

  updateModel: function (buttonName, state) {
    let material = state === 'up' ? this.material : this.highLightMaterial;
    const buttonMeshes = this.buttonMeshes;
    const button = buttonMeshes && buttonMeshes[buttonName];
    if (state === 'down' && button && !this.material) {
      material = this.material = button.material;
    }
    if (!material) { return; }
    if (buttonName === 'grip') {
      buttonMeshes.grip.left.material = material;
      buttonMeshes.grip.right.material = material;
      return;
    }
    if (!button) { return; }
    button.material = material;
  }
});
