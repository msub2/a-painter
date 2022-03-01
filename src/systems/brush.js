/* globals AFRAME THREE BinaryManager Utils */
const VERSION = 1;

AFRAME.BRUSHES = {};

const APAINTER_STATS = {
  brushes: {}
};

AFRAME.registerBrush = function (name, definition, options) {
  const proto = {};

  // Format definition object to prototype object.
  Object.keys(definition).forEach(function (key) {
    proto[key] = {
      value: definition[key],
      writable: true
    };
  });

  if (AFRAME.BRUSHES[name]) {
    throw new Error('The brush `' + name + '` has been already registered. ' +
                    'Check that you are not loading two versions of the same brush ' +
                    'or two different brushes of the same name.');
  }

  const BrushInterface = function () {};

  const defaultOptions = {
    spacing: 0,
    maxPoints: 0
  };

  BrushInterface.prototype = {
    options: Object.assign(defaultOptions, options),
    reset: function () {},
    tick: function (timeoffset, delta) {},
    undo: function () {},
    remove: function () {},
    addPoint: function (position, orientation, pointerPosition, pressure, timestamp) {},
    getJSON: function (system) {
      const points = [];
      for (let i = 0; i < this.data.points.length; i++) {
        const point = this.data.points[i];
        points.push({
          orientation: Utils.arrayNumbersToFixed(point.orientation.toArray()),
          position: Utils.arrayNumbersToFixed(point.position.toArray()),
          pressure: Utils.numberToFixed(point.pressure),
          timestamp: point.timestamp
        });
      }

      return {
        brush: {
          index: system.getUsedBrushes().indexOf(this.brushName),
          color: Utils.arrayNumbersToFixed(this.data.color.toArray()),
          size: Utils.numberToFixed(this.data.size)
        },
        points: points
      };
    },
    getBinary: function (system) {
      // Color = 3*4 = 12
      // NumPoints   =  4
      // Brush index =  1
      // ----------- = 21
      // [Point] = vector3 + quat + pressure + timestamp = (3+4+1+1)*4 = 36

      const bufferSize = 21 + (36 * this.data.points.length);
      const binaryManager = new BinaryManager(new ArrayBuffer(bufferSize));
      binaryManager.writeUint8(system.getUsedBrushes().indexOf(this.brushName)); // brush index
      binaryManager.writeColor(this.data.color); // color
      binaryManager.writeFloat32(this.data.size); // brush size

      // Number of points
      binaryManager.writeUint32(this.data.points.length);

      // Points
      for (let i = 0; i < this.data.points.length; i++) {
        const point = this.data.points[i];
        binaryManager.writeFloat32Array(point.position.toArray());
        binaryManager.writeFloat32Array(point.orientation.toArray());
        binaryManager.writeFloat32(point.pressure);
        binaryManager.writeUint32(point.timestamp);
      }
      return binaryManager.getDataView();
    }
  };

  function wrapInit (initMethod) {
    return function init (color, brushSize, owner, timestamp) {
      this.object3D = new THREE.Object3D();
      this.data = {
        points: [],
        size: brushSize,
        prevPosition: null,
        prevPointerPosition: null,
        numPoints: 0,
        color: color.clone(),
        timestamp: timestamp,
        owner: owner
      };
      initMethod.call(this, color, brushSize);
    };
  }

  function wrapAddPoint (addPointMethod) {
    return function addPoint (position, orientation, pointerPosition, pressure, timestamp) {
      if ((this.data.prevPosition && this.data.prevPosition.distanceTo(position) <= this.options.spacing) ||
          (this.options.maxPoints !== 0 && this.data.numPoints >= this.options.maxPoints)) {
        return;
      }
      if (addPointMethod.call(this, position, orientation, pointerPosition, pressure, timestamp)) {
        this.data.numPoints++;
        this.data.points.push({
          position: position.clone(),
          orientation: orientation.clone(),
          pressure: pressure,
          timestamp: timestamp
        });

        this.data.prevPosition = position.clone();
        this.data.prevPointerPosition = pointerPosition.clone();
      }
    };
  }

  const NewBrush = function () {};
  NewBrush.prototype = Object.create(BrushInterface.prototype, proto);
  NewBrush.prototype.brushName = name;
  NewBrush.prototype.constructor = NewBrush;
  NewBrush.prototype.init = wrapInit(NewBrush.prototype.init);
  NewBrush.prototype.addPoint = wrapAddPoint(NewBrush.prototype.addPoint);
  AFRAME.BRUSHES[name] = NewBrush;

  // console.log('New brush registered `' + name + '`');
  NewBrush.used = false; // Used to know which brushes have been used on the drawing
  return NewBrush;
};

AFRAME.registerSystem('brush', {
  schema: {},
  brushes: {},
  strokes: [],
  getUsedBrushes: function () {
    return Object.keys(AFRAME.BRUSHES)
      .filter(function (name) { return AFRAME.BRUSHES[name].used; });
  },
  getBrushByName: function (name) {
    return AFRAME.BRUSHES[name];
  },
  undo: function () {
    let stroke;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].data.owner !== 'local') continue;
      stroke = this.strokes.splice(i, 1)[0];
      break;
    }
    if (stroke) {
      stroke.undo();
      const drawing = document.querySelector('.a-drawing');
      drawing.emit('stroke-removed', { stroke: stroke });
    }
  },
  removeById: function (order) {
    order = 1;
    const targetStroke = this.strokes[order];
    console.log(targetStroke, this.strokes);
    if (targetStroke) {
      for (let i = this.strokes.length - 1; i > order; i--) {
        const stroke = this.strokes[i];
        if (targetStroke.sharedBuffer === stroke.sharedBuffer) {
          // Update idx and prevIdx
          console.log('>>>', stroke.prevIdx, '->', stroke.idx, 'target', targetStroke.prevIdx, '->', targetStroke.idx);
          for (const key in targetStroke.idx) {
            const diff = (targetStroke.idx[key] - targetStroke.prevIdx[key]);
            stroke.idx[key] -= diff;
            stroke.prevIdx[key] -= diff;
          }
          console.log('<<<', stroke.idx, stroke.prevIdx);
        }
      }
      this.strokes.splice(order, 1)[0].remove();
    }
  },
  clear: function () {
    // Remove all the stroke entities
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].data.owner !== 'local') continue;
      const stroke = this.strokes[i];
      stroke.undo();
      const drawing = document.querySelector('.a-drawing');
      drawing.emit('stroke-removed', { stroke: stroke });
    }

    // Reset the used brushes
    Object.keys(AFRAME.BRUSHES).forEach(function (name) {
      AFRAME.BRUSHES[name].used = false;
    });

    this.strokes = [];
  },
  init: function () {
    this.version = VERSION;
    this.clear();
    this.controllerName = null;

    const self = this;
    this.sceneEl.addEventListener('controllerconnected', function (evt) {
      self.controllerName = evt.detail.name;
    });
  },
  tick: function (time, delta) {
    if (!this.strokes.length) { return; }
    for (let i = 0; i < this.strokes.length; i++) {
      this.strokes[i].tick(time, delta);
    }
  },
  generateTestLines: function () {
    const z = -2;
    const size = 0.5;
    const width = 3;
    const pressure = 1;
    const numPoints = 4;

    const steps = width / numPoints;
    const brushesNames = Object.keys(AFRAME.BRUSHES);

    let x = -(size + 0.1) * brushesNames.length / 2;
    x = 0;
    const y = 0;
    brushesNames.forEach(function (brushName) {
      const color = new THREE.Color(Math.random(), Math.random(), Math.random());

      const stroke = this.addNewStroke(brushName, color, size);
      const entity = document.querySelector('#left-hand');
      entity.emit('stroke-started', { entity: entity, stroke: stroke });

      let position = new THREE.Vector3(x, y, z);
      const aux = new THREE.Vector3();

      for (let i = 0; i < numPoints; i++) {
        const orientation = new THREE.Quaternion();
        aux.set(0, steps, 0.1);
        const euler = new THREE.Euler(0, Math.PI, 0);
        orientation.setFromEuler(euler);
        position = position.add(aux);
        const timestamp = 0;

        const pointerPosition = this.getPointerPosition(position, orientation);
        stroke.addPoint(position, orientation, pointerPosition, pressure, timestamp);
      }

      x += size + 0.1;
    });
  },
  generateRandomStrokes: function (numStrokes) {
    function randNeg () { return 2 * Math.random() - 1; }

    const entity = document.querySelector('#left-hand');

    const brushesNames = Object.keys(AFRAME.BRUSHES);

    for (let l = 0; l < numStrokes; l++) {
      const brushName = brushesNames[parseInt(Math.random() * 13)];
      const color = new THREE.Color(Math.random(), Math.random(), Math.random());
      const size = Math.random() * 0.3;
      const numPoints = parseInt(Math.random() * 500);

      const stroke = this.addNewStroke(brushName, color, size);
      entity.emit('stroke-started', { entity: entity, stroke: stroke });

      let position = new THREE.Vector3(randNeg(), randNeg(), randNeg());
      const aux = new THREE.Vector3();
      const orientation = new THREE.Quaternion();

      let pressure = 0.2;
      for (let i = 0; i < numPoints; i++) {
        aux.set(randNeg(), randNeg(), randNeg());
        aux.multiplyScalar(randNeg() / 20);
        orientation.setFromUnitVectors(position.clone().normalize(), aux.clone().normalize());
        position = position.add(aux);
        if (position.y < 0) {
          position.y = -position.y;
        }
        const timestamp = 0;
        pressure += 1 - 2 * Math.random();
        if (pressure < 0) pressure = 0.2;
        if (pressure > 1) pressure = 1;

        const pointerPosition = this.getPointerPosition(position, orientation);
        stroke.addPoint(position, orientation, pointerPosition, pressure, timestamp);
      }
    }
  },
  addNewStroke: function (brushName, color, size, owner, timestamp) {
    if (!APAINTER_STATS.brushes[brushName]) {
      APAINTER_STATS.brushes[brushName] = 0;
    }
    APAINTER_STATS.brushes[brushName]++;

    owner = owner || 'local';
    timestamp = timestamp || Date.now();
    let Brush = this.getBrushByName(brushName);
    if (!Brush) {
      const newBrushName = Object.keys(AFRAME.BRUSHES)[0];
      Brush = AFRAME.BRUSHES[newBrushName];
      console.warn('Invalid brush name: `' + brushName + '` using `' + newBrushName + '`');
    }

    Brush.used = true;
    const stroke = new Brush();
    stroke.brush = Brush;
    stroke.init(color, size, owner, timestamp);
    this.strokes.push(stroke);

    let drawing = document.querySelector('.a-drawing');
    if (!drawing) {
      drawing = document.createElement('a-entity');
      drawing.className = 'a-drawing';
      document.querySelector('a-scene').appendChild(drawing);
    }

    return stroke;
  },
  getJSON: function () {
    // Strokes
    const json = {
      version: VERSION,
      strokes: [],
      author: '',
      brushes: this.getUsedBrushes()
    };

    for (let i = 0; i < this.strokes.length; i++) {
      json.strokes.push(this.strokes[i].getJSON(this));
    }

    return json;
  },
  getBinary: function () {
    const dataViews = [];
    const MAGIC = 'apainter';

    // Used brushes
    const usedBrushes = this.getUsedBrushes();

    // MAGIC(8) + version (2) + usedBrushesNum(2) + usedBrushesStrings(*)
    const bufferSize = MAGIC.length + usedBrushes.join(' ').length + 9;
    const binaryManager = new BinaryManager(new ArrayBuffer(bufferSize));

    // Header magic and version
    binaryManager.writeString(MAGIC);
    binaryManager.writeUint16(VERSION);

    binaryManager.writeUint8(usedBrushes.length);
    for (let i = 0; i < usedBrushes.length; i++) {
      binaryManager.writeString(usedBrushes[i]);
    }

    // Number of strokes
    binaryManager.writeUint32(this.strokes.length);
    dataViews.push(binaryManager.getDataView());

    // Strokes
    for (let i = 0; i < this.strokes.length; i++) {
      dataViews.push(this.strokes[i].getBinary(this));
    }
    return dataViews;
  },
  getPointerPosition: (function () {
    const pointerPosition = new THREE.Vector3();
    const controllerOffset = {
      'vive-controls': {
        vec: new THREE.Vector3(0, 0.7, 1),
        mult: -0.03
      },
      'oculus-touch-controls': {
        vec: new THREE.Vector3(0, 0, 2.8),
        mult: -0.05
      },
      'windows-motion-controls': {
        vec: new THREE.Vector3(0, 0, 1),
        mult: -0.12
      }
    };

    return function getPointerPosition (position, orientation) {
      if (!this.controllerName) {
        return position;
      }

      const offsets = controllerOffset[this.controllerName];
      const pointer = offsets.vec
        .clone()
        .applyQuaternion(orientation)
        .normalize()
        .multiplyScalar(offsets.mult);
      pointerPosition.copy(position).add(pointer);
      return pointerPosition;
    };
  })(),
  loadJSON: function (data) {
    if (data.version !== VERSION) {
      console.error('Invalid version: ', data.version, '(Expected: ' + VERSION + ')');
    }

    console.time('JSON Loading');

    // const usedBrushes = []; // Can likely be implemented in the future

    for (let i = 0; i < data.strokes.length; i++) {
      const strokeData = data.strokes[i];
      const brush = strokeData.brush;

      const stroke = this.addNewStroke(
        data.brushes[brush.index],
        new THREE.Color().fromArray(brush.color),
        brush.size
      );

      for (let j = 0; j < strokeData.points.length; j++) {
        const point = strokeData.points[j];

        const position = new THREE.Vector3().fromArray(point.position);
        const orientation = new THREE.Quaternion().fromArray(point.orientation);
        const pressure = point.pressure;
        const timestamp = point.timestamp;

        const pointerPosition = this.getPointerPosition(position, orientation);
        stroke.addPoint(position, orientation, pointerPosition, pressure, timestamp);
      }
    }

    console.timeEnd('JSON Loading');
  },
  loadBinary: function (buffer) {
    const binaryManager = new BinaryManager(buffer);
    const magic = binaryManager.readString();
    if (magic !== 'apainter') {
      console.error('Invalid `magic` header');
      return;
    }

    const version = binaryManager.readUint16();
    if (version !== VERSION) {
      console.error('Invalid version: ', version, '(Expected: ' + VERSION + ')');
    }

    console.time('Binary Loading');

    const numUsedBrushes = binaryManager.readUint8();
    const usedBrushes = [];
    for (let b = 0; b < numUsedBrushes; b++) {
      usedBrushes.push(binaryManager.readString());
    }

    const numStrokes = binaryManager.readUint32();

    for (let l = 0; l < numStrokes; l++) {
      const brushIndex = binaryManager.readUint8();
      const color = binaryManager.readColor();
      const size = binaryManager.readFloat();
      const numPoints = binaryManager.readUint32();

      const stroke = this.addNewStroke(usedBrushes[brushIndex], color, size);

      for (let i = 0; i < numPoints; i++) {
        const position = binaryManager.readVector3();
        const orientation = binaryManager.readQuaternion();
        const pressure = binaryManager.readFloat();
        const timestamp = binaryManager.readUint32();

        const pointerPosition = this.getPointerPosition(position, orientation);
        stroke.addPoint(position, orientation, pointerPosition, pressure, timestamp);
      }
    }
    console.timeEnd('Binary Loading');
  },
  loadFromUrl: function (url, binary) {
    const loader = new THREE.FileLoader(this.manager);
    loader.crossOrigin = 'anonymous';
    if (binary === true) {
      loader.setResponseType('arraybuffer');
    }

    const self = this;

    loader.load(url, function (buffer) {
      if (binary === true) {
        self.loadBinary(buffer);
      } else {
        self.loadJSON(JSON.parse(buffer));
      }
    });
  }
});
