// The swipe viewer for a carousel (slides.html)
(function () {
  // /slides?ids=12,13,14&i=0 — a carousel's slides, one per screen, swipe (or arrows / keys) to move
  const q = new URLSearchParams(location.search);
  const ids = String(q.get('ids') || '').split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 20);
  const start = Math.max(0, Math.min(ids.length - 1, parseInt(q.get('i') || '0', 10) || 0));
  const track = document.getElementById('track'), dots = document.getElementById('dots');
  track.innerHTML = ids.map((id, i) => `<div class="slide"><img src="/api/marketing?pfile=${id}" alt="Slide ${i + 1}" ${i > 2 ? 'loading="lazy"' : ''}></div>`).join('');
  dots.innerHTML = ids.length > 1 ? ids.map(() => '<i></i>').join('') : '';
  if (ids.length < 2) { document.getElementById('hint').remove(); document.getElementById('prev').remove(); document.getElementById('next').remove(); }
  const at = () => Math.round(track.scrollLeft / track.clientWidth);
  const show = () => { const i = at(); document.getElementById('count').textContent = ids.length > 1 ? `${i + 1} / ${ids.length}` : ''; [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); document.getElementById('open').href = `/api/marketing?pfile=${ids[i]}`; };
  const go = (i) => track.scrollTo({ left: Math.max(0, Math.min(ids.length - 1, i)) * track.clientWidth, behavior: 'smooth' });
  track.addEventListener('scroll', () => { requestAnimationFrame(show); const h = document.getElementById('hint'); if (h && at() > 0) h.remove(); });
  const p = document.getElementById('prev'), n = document.getElementById('next');
  if (p) p.onclick = () => go(at() - 1); if (n) n.onclick = () => go(at() + 1);
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(at() + 1); if (e.key === 'ArrowLeft') go(at() - 1); if (e.key === 'Escape') back(); });
  const back = () => { if (history.length > 1 && document.referrer) history.back(); else window.close(); setTimeout(() => { location.href = '/agents'; }, 300); };
  document.getElementById('back').onclick = back;
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; show(); });
  window.addEventListener('resize', () => { const i = at(); track.scrollLeft = i * track.clientWidth; });
})();
