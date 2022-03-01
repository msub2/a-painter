/* globals AFRAME ga */

AFRAME.registerComponent('vr-analytics', {
  init: function () {
    const el = this.el;
    let emitted = false;

    el.addEventListener('enter-vr', function () {
      if (emitted || !AFRAME.utils.device.checkHeadsetConnected() ||
          AFRAME.utils.device.isMobile()) { return; }
      ga('send', 'event', 'General', 'entervr');
      emitted = true;
    });
  }
});
