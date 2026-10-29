// ====== CONFIGURA ESTO ======
const SUPABASE_URL = 'https://akgzqoqublqfymjgnqvl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7DF3u_omK7IITfmM3Eyl5g_H84FAgHr'; // la clave "anon public", nunca la service_role
const VAPID_PUBLIC = 'PEGA_AQUI_TU_CLAVE_PUBLICA_VAPID'; // para los avisos en el móvil (ver LEEME.md)
const DOMINIO = 'amura.com'; // interno: el vecino solo escribe su ID
// ============================

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = d => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const hora = d => new Date(d).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const euro = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
const ESTADOS = { abierta: '🔴 Abierta', en_proceso: '🟡 En proceso', resuelta: '🟢 Resuelta' };
const PLURAL = { abierta: 'Abiertas', en_proceso: 'En proceso', resuelta: 'Resueltas' };
const ahora = () => new Date().toISOString();

let me = null, tab = 'incidencias', filtro = 'todas', vista = 'detalle';
// El presidente tiene los mismos permisos que la administración
const gestor = () => me && (me.rol !== 'vecino' || me.presidente);
// Reuniones y actas: solo administración (el presidente no las crea ni las modifica)
const redactor = () => me && me.rol !== 'vecino';
// El administrador es un usuario externo (no una vivienda); el resto son viviendas como p1p2c
const esVivienda = v => /^p\d+p\d+[a-z]$/.test(v);
const lugar = v => esVivienda(v) ? `Vivienda ${v.toUpperCase()}` : 'Administración';
const etiquetaUsuario = () => me.rol === 'admin' ? 'Administración'
  : me.rol === 'superadmin' ? (esVivienda(me.vivienda) ? `Vivienda ${me.vivienda.toUpperCase()} (superadmin)` : 'Superadmin')
  : `Vivienda ${me.vivienda.toUpperCase()}` + (me.presidente ? ' (presidente)' : '');
const mostrar = id => { $('#login').hidden = id !== 'login'; $('#app').hidden = id !== 'app'; };

// ---------- Tamaño de letra ----------
try { if (localStorage.getItem('amura-letra') === 'g') document.documentElement.classList.add('grande'); } catch (e) {}
$('#btn-letra').onclick = () => {
  const g = document.documentElement.classList.toggle('grande');
  try { localStorage.setItem('amura-letra', g ? 'g' : 'n'); } catch (e) {}
};

// ---------- App instalable y avisos en el móvil ----------
if (!window.__demoPush && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let avisosDemo = false;
async function suscripcion() {
  if (window.__demoPush || !pushOk()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
const guardarSub = s => { const j = s.toJSON(); return db.from('push_subs').upsert({ endpoint: j.endpoint, user_id: me.id, p256dh: j.keys.p256dh, auth: j.keys.auth }); };
async function estadoAvisos() {
  if (window.__demoPush) return avisosDemo;
  if (!pushOk()) return null;
  try { return !!(await suscripcion()); } catch (e) { return null; }
}
async function activarAvisos() {
  if (window.__demoPush) { avisosDemo = true; return 'ok'; }
  if (await Notification.requestPermission() !== 'granted') return 'denegado';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) });
    const { error } = await guardarSub(sub);
    return error ? 'error' : 'ok';
  } catch (e) { return 'error'; }
}
async function desactivarAvisos() {
  if (window.__demoPush) { avisosDemo = false; return; }
  const s = await suscripcion();
  if (s) { await db.from('push_subs').delete().eq('endpoint', s.endpoint); await s.unsubscribe(); }
}
async function sincronizarAvisos() { // si este móvil ya tenía avisos, los vuelve a enlazar con esta vivienda
  try { const s = await suscripcion(); if (s && Notification.permission === 'granted') await guardarSub(s); } catch (e) {}
}

// ---------- Acceso ----------
$('#form-login').onsubmit = async e => {
  e.preventDefault();
  const id = $('#uid').value.trim().toLowerCase();
  const { error } = await db.auth.signInWithPassword({ email: `${id}@${DOMINIO}`, password: $('#pwd').value });
  if (error) return ($('#err').textContent = 'El ID o la contraseña no son correctos.');
  $('#err').textContent = '';
  $('#pwd').value = '';
  init();
};
$('#btn-salir').onclick = async () => {
  try { const s = await suscripcion(); if (s) await db.from('push_subs').delete().eq('endpoint', s.endpoint); } catch (e) {}
  await db.auth.signOut(); me = null; mostrar('login');
};
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

const MANUAL = `<div class="manual">
<h4>Entrar</h4><ul><li>Escribe el ID de tu vivienda y la contraseña que te dio la administración.</li>
<li>El ID tiene este formato: p1p2c = portal 1, planta 2, puerta C.</li></ul>
<h4>Incidencias</h4><ul><li>Pulsa el botón naranja “Nueva incidencia” para avisar de un problema o hacer una reclamación.</li>
<li>“Detalle” muestra cada caso completo, con un desplegable “Filtrar por” para elegir cuáles ver.</li>
<li>“Resumen” muestra de un vistazo cuántas hay abiertas, en proceso y resueltas, y la fecha de su última novedad.</li></ul>
<h4>Reuniones y actas</h4><ul><li>En Reuniones ves las próximas convocatorias y las anteriores.</li>
<li>En Actas pulsa “Leer acta” para ver su contenido.</li></ul>
<h4>Cuentas</h4><ul><li>Muestra el dinero disponible de la comunidad y cuándo se actualizó.</li>
<li>Solo la administración y el presidente pueden cambiar los saldos.</li></ul>
<h4>Avisos en el móvil</h4><ul><li>En “Ayuda” puedes activar o desactivar los avisos cuando quieras.</li>
<li>Para recibirlos, instala la app: en Android, menú del navegador y “Instalar aplicación”; en iPhone, botón Compartir y “Añadir a pantalla de inicio”.</li></ul>
<h4>Letra y cuenta</h4><ul><li>El botón “A+” agranda o reduce la letra.</li>
<li>En “Ayuda” puedes cambiar tu contraseña. “Salir” cierra tu sesión.</li>
<li>Si pierdes la contraseña, pídesela a la administración.</li></ul>
<h4>Administración y presidente</h4><ul><li>Ambos gestionan las incidencias (“Gestionar”: estado y respuesta) y actualizan las cuentas.</li>
<li>Solo la administración convoca reuniones y publica actas.</li>
<li>Si eliminas una cuenta, una reunión o un acta, puedes pulsar “Deshacer” unos segundos.</li></ul></div>`;

function abrirDialogo(titulo, html, botones) {
  $('#dlg-t').textContent = titulo;
  const f = $('#dlg-f');
  f.innerHTML = html;
  f.onsubmit = e => e.preventDefault();
  botones && Object.entries(botones).forEach(([id, fn]) => { const b = document.getElementById(id); if (b) b.onclick = fn; });
  $('#dlg').showModal();
}
const cerrar = () => $('#dlg').close();
// Ventanas propias (los avisos del navegador pueden estar bloqueados y no se ven)
const aviso = t => abrirDialogo('Aviso', `<p>${esc(t)}</p><button type="button" class="pri bloque" id="cerrar">Entendido</button>`, { cerrar });
function confirmar(texto, boton = 'Sí, eliminar') {
  return new Promise(res => {
    let fin = false; const r = v => { if (!fin) { fin = true; res(v); } };
    abrirDialogo('¿Seguro?', `<p>${esc(texto)}</p><button type="button" class="pri bloque" id="si">${boton}</button><button type="button" class="sec bloque" id="no">Cancelar</button>`,
      { si: () => { r(true); cerrar(); }, no: () => { r(false); cerrar(); } });
    $('#dlg').addEventListener('close', () => r(false), { once: true });
  });
}
let tt;
function toast(texto, deshacer) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(texto)}</span><button type="button" id="t-un">Deshacer</button>`;
  t.hidden = false;
  $('#t-un').onclick = () => { t.hidden = true; clearTimeout(tt); deshacer(); };
  clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 8000);
}
function manual() {
  abrirDialogo('Manual de usuario', MANUAL + '<button type="button" class="pri bloque" id="cerrar">Entendido</button>', { cerrar });
}
$('#btn-manual').onclick = manual;
$('#btn-ayuda').onclick = async () => {
  const est = await estadoAvisos();
  const avisos = est === null
    ? '<p class="meta">Este navegador no permite avisos. En iPhone, instala primero la app: botón Compartir y “Añadir a pantalla de inicio”.</p>'
    : `<button type="button" class="${est ? 'sec' : 'pri'} bloque" id="a-av">${est ? '🔕 Desactivar avisos en el móvil' : '🔔 Activar avisos en el móvil'}</button>
       <p class="meta">Avisos ahora: ${est ? 'activados' : 'desactivados'}${window.__demoPush ? ' (en la demo es solo una simulación)' : ''}</p>`;
  abrirDialogo('Ayuda y cuenta',
    '<button type="button" class="sec bloque" id="a-man">📖 Manual de usuario</button>' + avisos +
    '<button type="button" class="sec bloque" id="a-pwd">🔑 Cambiar mi contraseña</button><button type="button" class="pri bloque" id="cerrar">Cerrar</button>',
    { cerrar, 'a-man': manual,
      'a-pwd': () => formulario('Cambiar contraseña', [{ n: 'p', l: 'Nueva contraseña (mínimo 6 caracteres)', t: 'password', r: 1 }], v => db.auth.updateUser({ password: v.p })),
      'a-av': async () => {
        if (est) await desactivarAvisos();
        else {
          const r = await activarAvisos();
          if (r !== 'ok') { cerrar(); return aviso(r === 'denegado' ? 'Los avisos están bloqueados. Actívalos en los ajustes del navegador para esta web.' : 'No se pudieron activar los avisos.'); }
        }
        cerrar(); $('#btn-ayuda').click();
      } });
};

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return mostrar('login');
  const { data } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  if (!data) { await db.auth.signOut(); return mostrar('login'); }
  me = data;
  $('#quien').textContent = etiquetaUsuario();
  mostrar('app');
  render();
  sincronizarAvisos();
}

// ---------- Formulario genérico ----------
function formulario(titulo, campos, guardar) {
  abrirDialogo(titulo, campos.map(c => `<label>${c.l}` + (
    c.t === 'textarea' ? `<textarea name="${c.n}" rows="6" ${c.r ? 'required' : ''}></textarea>` :
    c.t === 'select' ? `<select name="${c.n}">${c.o.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>` :
    `<input name="${c.n}" type="${c.t || 'text'}" step="any" ${c.r ? 'required' : ''}>`) + '</label>').join('') +
    '<div class="acc"><button type="button" class="sec" id="cancelar">Cancelar</button><button class="pri">Guardar</button></div>', { cancelar: cerrar });
  $('#dlg-f').insertAdjacentHTML('afterbegin', '<p class="error" id="ferr"></p>');
  $('#dlg-f').onsubmit = async e => {
    e.preventDefault();
    const { error } = await guardar(Object.fromEntries(new FormData($('#dlg-f'))));
    if (error) return ($('#ferr').textContent = 'No se pudo guardar. ' + error.message);
    cerrar();
    render();
  };
}

function nuevo(t) {
  if (t === 'incidencias') return formulario('Nueva incidencia', [
    { n: 'tipo', l: 'Tipo', t: 'select', o: [['incidencia', 'Incidencia'], ['reclamacion', 'Reclamación']] },
    { n: 'titulo', l: 'Título', r: 1 },
    { n: 'descripcion', l: 'Cuéntanos qué ocurre', t: 'textarea', r: 1 }],
    v => db.from('incidencias').insert({ ...v, vivienda: me.vivienda, autor: me.id }));
  if (t === 'reuniones') return formulario('Nueva reunión', [
    { n: 'titulo', l: 'Título', r: 1 },
    { n: 'fecha', l: 'Fecha y hora', t: 'datetime-local', r: 1 },
    { n: 'lugar', l: 'Lugar' },
    { n: 'descripcion', l: 'Orden del día', t: 'textarea' }],
    v => db.from('reuniones').insert({ ...v, fecha: new Date(v.fecha).toISOString() }));
  if (t === 'actas') return formulario('Nueva acta', [
    { n: 'titulo', l: 'Título', r: 1 },
    { n: 'fecha', l: 'Fecha', t: 'date', r: 1 },
    { n: 'contenido', l: 'Contenido', t: 'textarea', r: 1 }],
    v => db.from('actas').insert(v));
  if (t === 'cuentas') return formulario('Añadir cuenta', [
    { n: 'nombre', l: 'Nombre (por ejemplo, Cuenta corriente)', r: 1 },
    { n: 'saldo', l: 'Saldo actual en euros', t: 'number', r: 1 }],
    v => db.from('cuentas').insert({ ...v, actualizada_at: ahora() }));
}

// ---------- Vistas ----------
const ACCION = { incidencias: ['Nueva incidencia', () => true], reuniones: ['Nueva reunión', redactor], actas: ['Nueva acta', redactor], cuentas: ['Añadir cuenta', gestor] };
async function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const m = $('#main');
  m.onclick = clic;
  m.onchange = e => { if (e.target.id === 'filtro') { filtro = e.target.value; render(); } };
  m.innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    await { incidencias: vIncidencias, reuniones: vReuniones, actas: vActas, cuentas: vCuentas }[tab](m);
    const a = ACCION[tab];
    if (a[1]()) m.insertAdjacentHTML('beforeend', `<button class="fab" data-act="new" data-t="${tab}">＋ ${a[0]}</button>`);
  } catch (e) { m.innerHTML = '<p class="vacio">No se pudo cargar. Revisa tu conexión e inténtalo de nuevo.</p>'; }
}

const titulo = t => `<div class="barra"><h2>${t}</h2></div>`;
const borrar = t => `<button class="sec" data-act="del" data-t="${t}">Eliminar</button>`;

const tarjetaInc = i => `<article class="card s-${i.estado}" data-id="${i.id}">
  <div class="fila"><span class="b ${i.estado}">${ESTADOS[i.estado]}</span><span class="b">${i.tipo === 'reclamacion' ? 'Reclamación' : 'Incidencia'}</span></div>
  <h3>${esc(i.titulo)}</h3>
  <p class="meta">${esc(lugar(i.vivienda))}. Creada el ${fecha(i.created_at)}</p>
  ${i.actualizada_at ? `<p class="meta act">🔄 Actualizada el ${fecha(i.actualizada_at)}</p>` : ''}
  <p class="texto">${esc(i.descripcion)}</p>
  ${i.respuesta ? `<p class="resp"><strong>Administración:</strong> ${esc(i.respuesta)}</p>` : ''}
  ${gestor() ? `<details><summary>Gestionar</summary>
    <label>Estado<select>${Object.entries(ESTADOS).map(([k, t]) => `<option value="${k}"${k === i.estado ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Respuesta para el vecino<textarea rows="3">${esc(i.respuesta || '')}</textarea></label>
    <div class="acc">${borrar('incidencias')}<button class="pri" data-act="ok">Guardar</button></div></details>` : ''}
</article>`;

async function vIncidencias(m) {
  const { data, error } = await db.from('incidencias').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const seg = `<div class="seg"><button class="${vista === 'detalle' ? 'on' : ''}" data-v="detalle">📋 Detalle</button><button class="${vista === 'resumen' ? 'on' : ''}" data-v="resumen">📊 Resumen</button></div>`;
  const hola = `<div class="hola"><strong>¡Hola! 👋</strong><span>${esc(etiquetaUsuario())}. ¿Qué quieres hacer hoy?</span></div>`;
  if (vista === 'resumen') {
    const n = e => data.filter(i => i.estado === e).length;
    const filas = [...data].sort((a, b) => new Date(b.actualizada_at || b.created_at) - new Date(a.actualizada_at || a.created_at))
      .map(i => `<div class="res"><div><strong>${esc(i.titulo)}</strong><small>${i.tipo === 'reclamacion' ? 'Reclamación' : 'Incidencia'}, ${esc(lugar(i.vivienda))}</small></div>
        <div class="der"><span class="b ${i.estado}">${ESTADOS[i.estado]}</span><small>${i.actualizada_at ? 'Actualizada el ' + fecha(i.actualizada_at) : 'Creada el ' + fecha(i.created_at)}</small></div></div>`).join('');
    m.innerHTML = hola + seg + `<div class="tiles">${Object.keys(ESTADOS).map(e => `<div class="tile ${e}"><strong>${n(e)}</strong><span>${PLURAL[e]}</span></div>`).join('')}</div>` +
      titulo('Todas las incidencias y reclamaciones') + (filas || '<p class="vacio">Todavía no hay incidencias.</p>');
    return;
  }
  const l = data.filter(i => filtro === 'todas' || (filtro === 'mias' ? i.autor === me.id : i.estado === filtro));
  const opciones = [['todas', 'Todas'], ['abierta', 'Abiertas'], ['en_proceso', 'En proceso'], ['resuelta', 'Resueltas'], ['mias', 'Mis incidencias']]
    .map(([k, t]) => `<option value="${k}"${filtro === k ? ' selected' : ''}>${t}</option>`).join('');
  m.innerHTML = hola + seg + `<label class="filtro">Filtrar por<select id="filtro">${opciones}</select></label>` +
    (l.length ? l.map(tarjetaInc).join('') : '<p class="vacio">No hay incidencias en esta lista.</p>');
}

async function vReuniones(m) {
  const { data, error } = await db.from('reuniones').select('*').order('fecha');
  if (error) throw error;
  const hoy = Date.now();
  const prox = data.filter(r => new Date(r.fecha) >= hoy), pas = data.filter(r => new Date(r.fecha) < hoy).reverse();
  const tarjeta = r => `<article class="card" data-id="${r.id}"><h3>📅 ${esc(r.titulo)}</h3>
    <p class="meta">${hora(r.fecha)}${r.lugar ? ', ' + esc(r.lugar) : ''}</p>
    ${r.descripcion ? `<p class="texto">${esc(r.descripcion)}</p>` : ''}
    ${redactor() ? `<div class="acc">${borrar('reuniones')}</div>` : ''}</article>`;
  m.innerHTML = titulo('Reuniones') + '<h4>Próximas</h4>' + (prox.length ? prox.map(tarjeta).join('') : '<p class="vacio">No hay reuniones convocadas.</p>') +
    (pas.length ? '<h4>Anteriores</h4>' + pas.map(tarjeta).join('') : '');
}

async function vActas(m) {
  const { data, error } = await db.from('actas').select('*').order('fecha', { ascending: false });
  if (error) throw error;
  m.innerHTML = titulo('Actas') + (data.length ? data.map(a => `<article class="card k-actas" data-id="${a.id}"><h3>📄 ${esc(a.titulo)}</h3><p class="meta">${fecha(a.fecha)}</p>
    <details><summary>Leer acta</summary><p class="texto">${esc(a.contenido)}</p>${redactor() ? `<div class="acc">${borrar('actas')}</div>` : ''}</details></article>`).join('')
    : '<p class="vacio">Todavía no hay actas publicadas.</p>');
}

async function vCuentas(m) {
  const { data, error } = await db.from('cuentas').select('*').order('nombre');
  if (error) throw error;
  const { data: pr } = await db.from('profiles').select('vivienda').eq('presidente', true);
  const total = data.reduce((s, c) => s + Number(c.saldo), 0);
  m.innerHTML = titulo('Cuentas') + `<div class="total"><span>💶 Total disponible de la comunidad</span><strong>${euro(total)}</strong></div>` +
    (data.length ? data.map(c => `<article class="card k-cuentas" data-id="${c.id}"><h3>${esc(c.nombre)}</h3><p class="saldo">${euro(c.saldo)}</p>
      <p class="meta act">🔄 Actualizado el ${fecha(c.actualizada_at)}</p>
      ${gestor() ? `<div class="acc">${borrar('cuentas')}<button class="pri" data-act="saldo">Actualizar saldo</button></div>` : ''}</article>`).join('')
      : '<p class="vacio">Todavía no hay cuentas registradas.</p>') +
    `<p class="meta">Presidente de la comunidad: ${pr && pr.length ? 'vivienda ' + esc(pr[0].vivienda).toUpperCase() : 'sin asignar'}</p>` +
    (me.rol === 'superadmin' ? '<button class="sec bloque" data-act="pres">Cambiar presidente</button>' : '');
}

// ---------- Clics de las listas ----------
async function clic(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const c = b.closest('[data-id]'), id = c && c.dataset.id;
  if (b.dataset.v) { vista = b.dataset.v; return render(); }
  if (b.dataset.act === 'new') return nuevo(b.dataset.t);
  if (b.dataset.act === 'ok') {
    const { error } = await db.from('incidencias').update({ estado: c.querySelector('select').value, respuesta: c.querySelector('textarea').value.trim() || null, actualizada_at: ahora() }).eq('id', id);
    return error ? aviso('No se pudo guardar el cambio.') : render();
  }
  if (b.dataset.act === 'saldo') return formulario('Actualizar saldo', [{ n: 'saldo', l: 'Nuevo saldo en euros', t: 'number', r: 1 }],
    v => db.from('cuentas').update({ saldo: v.saldo, actualizada_at: ahora() }).eq('id', id));
  if (b.dataset.act === 'pres') {
    const { data: vs } = await db.from('profiles').select('vivienda').order('vivienda');
    return formulario('Presidente de la comunidad', [{ n: 'vivienda', l: 'Vivienda del presidente', t: 'select', o: vs.filter(x => esVivienda(x.vivienda)).map(x => [x.vivienda, x.vivienda.toUpperCase()]) }],
      v => db.rpc('asignar_presidente', { vid: v.vivienda }));
  }
  if (b.dataset.act === 'del') {
    const t = b.dataset.t, recuperable = t !== 'incidencias';
    if (!await confirmar(recuperable ? 'Se eliminará, pero podrás deshacerlo durante unos segundos.' : 'Esta incidencia se eliminará definitivamente.')) return;
    const { data: copia } = await db.from(t).select('*').eq('id', id).single();
    const { error } = await db.from(t).delete().eq('id', id);
    if (error) return aviso('No se pudo eliminar.');
    render();
    if (recuperable && copia) toast('Eliminado.', async () => {
      const { id: _, ...resto } = copia;
      const r = await db.from(t).insert(resto);
      if (r.error) aviso('No se pudo recuperar.');
      render();
    });
  }
}

init();
