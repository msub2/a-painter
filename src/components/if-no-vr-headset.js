/* global AFRAME */
const utils = AFRAME.utils;

/**
 * Set properties if headset is not connected by checking isSessionSupported().
 */
AFRAME.registerComponent('if-no-vr-headset', {
  schema: {
    default: {},
    parse: utils.styleParser.parse
  },

  update: function () {
    const self = this;

    // Don't count mobile as VR.
    if (this.el.sceneEl.isMobile) {
      this.setProperties();
      return;
    }

    // Check isSessionSupported() to determine if headset is connected.
    navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
      if (supported) return;
      self.setProperties();
    });
  },

  setProperties: function () {
    const data = this.data;
    const el = this.el;
    Object.keys(data).forEach(function set (component) {
      el.setAttribute(component, data[component]);
    });
  }
});
