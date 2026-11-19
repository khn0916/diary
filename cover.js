(function () {
  'use strict';
  const scene = document.getElementById('coverScene');
  const workspace = document.getElementById('diaryWorkspace');
  const openButton = document.getElementById('openDiary');
  const closeButton = document.getElementById('closeDiary');
  const year = document.getElementById('coverYear');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let opening = false, revealTimer, finishTimer;

  function updateYear() {
    const digits = String(new Date().getFullYear());
    year.replaceChildren(...[digits.slice(0, 2), digits.slice(2)].map(value => {
      const part = document.createElement('span'); part.textContent = value; return part;
    }));
  }
  function centerMonthly() {
    const viewport = workspace.querySelector('.book-viewport');
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
  }
  function finishOpening() {
    if (!opening) return;
    clearTimeout(revealTimer); clearTimeout(finishTimer);
    scene.hidden = true;
    scene.classList.remove('is-opening', 'is-finished');
    workspace.hidden = false; workspace.inert = false;
    workspace.classList.remove('is-revealing');
    document.body.classList.remove('diary-closed', 'diary-opening');
    opening = false; openButton.disabled = false;
    document.getElementById('monthTitle').setAttribute('tabindex', '-1');
    document.getElementById('monthTitle').focus({ preventScroll: true });
    centerMonthly();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
  function open() {
    if (opening || scene.hidden) return;
    opening = true; openButton.disabled = true;
    // Use the existing month navigation so entries and all other behavior survive.
    document.getElementById('todayButton').click();
    workspace.hidden = false; workspace.inert = true;
    document.body.classList.replace('diary-closed', 'diary-opening');
    if (reducedMotion.matches) { finishOpening(); return; }
    workspace.classList.add('is-revealing');
    scene.classList.add('is-opening');
    centerMonthly();
    revealTimer = setTimeout(() => {
      workspace.classList.remove('is-revealing');
      scene.classList.add('is-finished');
    }, 1050);
    finishTimer = setTimeout(finishOpening, 1750);
  }
  function close() {
    if (opening || workspace.querySelector('.book.turning,.book.turn-held')) return;
    scene.hidden = false;
    workspace.hidden = true; workspace.inert = true;
    document.body.classList.add('diary-closed');
    updateYear();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    openButton.focus({ preventScroll: true });
  }
  workspace.inert = true;
  updateYear();
  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  reducedMotion.addEventListener('change', () => { if (opening && reducedMotion.matches) finishOpening(); });
})();
