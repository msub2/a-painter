/* globals AFRAME */
AFRAME.registerSystem('ui', {
  init: function () {
    this.initTextures();
  },

  initTextures: function () {
    const self = this;
    const hoverTextureUrl = 'assets/images/ui-hover.png';
    const pressedTextureUrl = 'assets/images/ui-pressed.png';
    this.sceneEl.systems.material.loadTexture(hoverTextureUrl, { src: hoverTextureUrl }, onLoadedHoverTexture);
    this.sceneEl.systems.material.loadTexture(pressedTextureUrl, { src: pressedTextureUrl }, onLoadedPressedTexture);
    function onLoadedHoverTexture (texture) {
      self.hoverTexture = texture;
    }
    function onLoadedPressedTexture (texture) {
      self.pressedTexture = texture;
    }
  },

  closeAll: function () {
    const els = document.querySelectorAll('[ui]');
    for (let i = 0; i < els.length; i++) {
      els[i].components.ui.close();
    }
  }
});
