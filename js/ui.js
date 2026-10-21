import { $, $$, errMsg, role, toast } from './core.js';

/* =====================================================================
   MODAL
   ===================================================================== */
function openModal(title, body, {wide = false, onMount} = {}){
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div></div>`;
  m.hidden = false;
  $$('[data-close]', m).forEach(b => b.onclick = e => { e.preventDefault(); closeModal(); });
  onMount && onMount(m);
  const first = m.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea');
  first && setTimeout(() => first.focus(), 30);
}
function closeModal(){ const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
const formObj = form => Object.fromEntries(new FormData(form));
function formErr(msg){ const e = $('#fe'); if (e){ e.textContent = msg; e.hidden = !msg; } }
async function busy(btn, fn){
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Saving…';
  try { await fn(); } catch (e){ console.error(e); formErr(errMsg(e)); toast(errMsg(e), 'err'); }
  finally { if (btn.isConnected){ btn.disabled = false; btn.textContent = t; } }
}
const actionsRow = (label = 'Save', cls = 'teal') =>
  `<div class="err" id="fe" hidden></div><div class="form-actions"><button class="btn" data-close>Cancel</button><button class="btn ${cls}" id="go">${label}</button></div>`;

export { openModal, closeModal, formObj, formErr, busy, actionsRow };
