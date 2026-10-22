/* CampusFix — opening animation: plays once per browser session, skipped for reduced-motion users, tap to skip */
(function () {
  var root = document.documentElement, KEY = 'campusfix.intro', skip = false;
  try { skip = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) skip = true;
  if (skip) { root.classList.add('no-intro'); return; }
  try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('intro'); if (!el) { root.classList.add('no-intro'); return; }
    var finish = function () { root.classList.add('no-intro'); };
    el.addEventListener('click', function () { root.classList.add('intro-skip'); el.classList.add('leave'); setTimeout(finish, 650); });
    el.addEventListener('animationend', function (e) { if (e.animationName === 'introOut') finish(); });
    setTimeout(finish, 4500); // failsafe
  });
})();
