(function() {
  function initLoginBG() {
    var loginEl = document.getElementById('s-login');
    var canvas  = document.getElementById('lx-canvas');
    if (!canvas || typeof THREE === 'undefined' || !loginEl) {
      setTimeout(initLoginBG, 200); return;
    }
    var W = loginEl.offsetWidth  || window.innerWidth;
    var H = loginEl.offsetHeight || window.innerHeight;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);

    var scene  = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.z = 5;

    var count     = 1800;
    var geo       = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    var colors    = new Float32Array(count * 3);
    var palette   = [[0, 0.85, 1], [0.66, 0.33, 0.97], [0.055, 0.647, 0.914]];
    for (var i = 0; i < count; i++) {
      var i3 = i * 3;
      positions[i3]   = (Math.random() - 0.5) * 18;
      positions[i3+1] = (Math.random() - 0.5) * 12;
      positions[i3+2] = (Math.random() - 0.5) * 8;
      var c = palette[Math.floor(Math.random() * palette.length)];
      colors[i3] = c[0]; colors[i3+1] = c[1]; colors[i3+2] = c[2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    var mat       = new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true, opacity: 0.75 });
    var particles = new THREE.Points(geo, mat);
    scene.add(particles);

    var linesMat  = new THREE.LineBasicMaterial({ color: 0x6366F1, transparent: true, opacity: 0.06 });
    var nodeCount = 30, nodes = [];
    for (var n = 0; n < nodeCount; n++) {
      nodes.push(new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 3
      ));
    }
    for (var a = 0; a < nodes.length; a++) {
      for (var b = a + 1; b < nodes.length; b++) {
        if (nodes[a].distanceTo(nodes[b]) < 4.5) {
          scene.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([nodes[a], nodes[b]]),
            linesMat
          ));
        }
      }
    }

    var mx = 0, my = 0;
    document.addEventListener('mousemove', function(e) {
      mx =  (e.clientX / window.innerWidth  - 0.5) * 0.6;
      my =  (e.clientY / window.innerHeight - 0.5) * 0.4;
    }, { passive: true });

    window.addEventListener('resize', function() {
      var el = document.getElementById('s-login');
      if (!el) return;
      var w = el.offsetWidth, h = el.offsetHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });

    var _bgRunning = true;
    window.stopLoginBG = function() { _bgRunning = false; };

    function animate() {
      if (!_bgRunning) {
        renderer.dispose();  // free GPU resources
        return;
      }
      var loginEl = document.getElementById('s-login');
      if (!loginEl || !loginEl.classList.contains('on')) {
        setTimeout(function() { requestAnimationFrame(animate); }, 2000);
        return;
      }
      requestAnimationFrame(animate);
      particles.rotation.y += 0.0006;
      particles.rotation.x += 0.0002;
      camera.position.x += (mx  - camera.position.x) * 0.04;
      camera.position.y += (-my - camera.position.y) * 0.04;
      renderer.render(scene, camera);
    }
    animate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginBG);
  } else {
    setTimeout(initLoginBG, 150);
  }
})();
