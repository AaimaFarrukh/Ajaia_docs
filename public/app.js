'use strict';
const root = document.getElementById('app');
const state = { user: null };
let teardown = () => {};

/* ---------- helpers ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'svg') el.innerHTML = v; // trusted constants only
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

async function api(method, path, body, { raw = false, headers = {} } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body != null && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    const e = new Error('Can’t reach the server. Check your connection.');
    e.network = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; location.hash = '#/login'; }
    const e = new Error(data.error || 'Something went wrong.');
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const initials = (name) => name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const ICON = {
  bold: '<svg viewBox="0 0 24 24"><path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24"><path d="M14 5h-4M14 19h-4M15 5l-6 14"/></svg>',
  underline: '<svg viewBox="0 0 24 24"><path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/></svg>',
  ul: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  ol: '<svg viewBox="0 0 24 24"><path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14h3l-3 3.5h3"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/></svg>',
  quote: '<svg viewBox="0 0 24 24"><path d="M5 5v14M10 8h9M10 12h9M10 16h6"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>',
  upload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
};

function topbar(extra) {
  const u = state.user;
  return h('header', { class: 'bar' },
    h('a', { class: 'wordmark', href: '#/' }, 'Ajaia ', h('span', {}, 'Docs')),
    h('div', { class: 'grow' }),
    extra,
    u && h('div', { class: 'who' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.name)),
      h('span', { class: 'name' }, u.name),
      h('button', { class: 'btn quiet', onClick: logout }, 'Sign out')));
}

async function logout() {
  try { await api('POST', '/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  location.hash = '#/login';
}

/* ---------- login ---------- */
const DEMOS = [
  { email: 'alice@ajaia.test', name: 'Alice Moreno', note: 'Owns “Q4 launch plan”, shared with Ben and Chloe' },
  { email: 'ben@ajaia.test', name: 'Ben Okafor', note: 'Editor on Alice’s plan' },
  { email: 'chloe@ajaia.test', name: 'Chloe Tanaka', note: 'View-only on Alice’s plan' },
];

function loginView() {
  let mode = 'signin';
  const err = h('p', { class: 'error', role: 'alert' });
  const email = h('input', { class: 'input', id: 'email', type: 'email', autocomplete: 'username', required: true });
  const pass = h('input', { class: 'input', id: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '8' });
  const name = h('input', { class: 'input', id: 'name', type: 'text', autocomplete: 'name', maxlength: '80' });
  const nameField = h('div', { class: 'field', hidden: true }, h('label', { for: 'name' }, 'Your name'), name);
  const submit = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;justify-content:center;height:42px' }, 'Sign in');
  const title = h('h1', {}, 'Sign in to your documents');
  const lede = h('p', { class: 'lede' }, 'Draft together, share with a teammate, keep everything in one place.');
  const switchBtn = h('button', { type: 'button', onClick: () => setMode(mode === 'signin' ? 'signup' : 'signin') }, 'Create an account');
  const switchText = h('p', { class: 'switch' }, 'New here? ', switchBtn);

  function setMode(m) {
    mode = m;
    const up = m === 'signup';
    nameField.hidden = !up;
    title.textContent = up ? 'Create your account' : 'Sign in to your documents';
    submit.textContent = up ? 'Create account' : 'Sign in';
    pass.autocomplete = up ? 'new-password' : 'current-password';
    switchText.firstChild.textContent = up ? 'Already have an account? ' : 'New here? ';
    switchBtn.textContent = up ? 'Sign in' : 'Create an account';
    err.textContent = '';
  }

  const form = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      try {
        const body = { email: email.value, password: pass.value };
        if (mode === 'signup') body.name = name.value;
        const r = await api('POST', mode === 'signup' ? '/auth/signup' : '/auth/login', body);
        state.user = r.user;
        location.hash = '#/';
      } catch (ex) { err.textContent = ex.message; }
      finally { submit.disabled = false; }
    },
  },
    nameField,
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Work email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), pass),
    err, submit, switchText);

  const demo = h('div', { class: 'demo' },
    h('h2', {}, 'Try it with a demo account'),
    h('p', {}, 'Password for all three: ajaia-demo-1. Sign in as one, then open another browser window as a second to see sharing.'),
    h('div', { class: 'demo-list' }, DEMOS.map((d) => h('button', {
      class: 'demo-user', type: 'button',
      onClick: () => { setMode('signin'); email.value = d.email; pass.value = 'ajaia-demo-1'; submit.focus(); },
    }, h('span', {}, h('strong', {}, d.name), h('small', {}, d.note)), h('span', { class: 'fill' }, 'Fill in')))));

  const sheet = h('div', { class: 'sheet', 'aria-hidden': 'true' },
    h('h3', {}, 'Q4 launch plan'),
    h('p', {}, 'Ship the team workspace to every ', h('mark', {}, 'internal pilot group'), ' before the quarter closes.'),
    h('ul', {}, h('li', {}, 'Pilot feedback closed out'), h('li', {}, 'Permissions review with Security')));

  root.replaceChildren(h('main', { class: 'login' },
    h('section', { class: 'login-form' },
      h('a', { class: 'wordmark', href: '#/login' }, 'Ajaia ', h('span', {}, 'Docs')), title, lede, form),
    h('section', { class: 'login-side' }, sheet, demo)));
}

/* ---------- library ---------- */
async function libraryView() {
  root.replaceChildren(topbar(), h('p', { class: 'loading' }, 'Loading your documents…'));
  let data;
  try { data = await api('GET', '/docs'); }
  catch (e) { if (e.status === 401) return; root.replaceChildren(topbar(), h('p', { class: 'loading' }, e.message)); return; }

  let tab = 'all';
  const list = h('div', { class: 'rows' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const fileInput = h('input', { type: 'file', accept: '.txt,.md,.markdown,.docx', class: 'sr', tabindex: '-1', onChange: onImport });

  async function create() {
    try { const r = await api('POST', '/docs', {}); location.hash = `#/d/${r.id}`; }
    catch (e) { toast(e.message, true); }
  }
  async function onImport() {
    const f = fileInput.files[0];
    if (!f) return;
    fileInput.value = '';
    if (f.size > 5 * 1024 * 1024) return toast('That file is over 5 MB. Import a smaller one.', true);
    try {
      toast('Importing…');
      const r = await api('POST', '/import', await f.arrayBuffer(), { raw: true, headers: { 'x-filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' } });
      location.hash = `#/d/${r.id}`;
    } catch (e) { toast(e.message, true); }
  }
  async function remove(d) {
    const extra = d.sharedCount ? ` It’s shared with ${d.sharedCount} ${d.sharedCount === 1 ? 'person' : 'people'}, who will lose access.` : '';
    if (!confirm(`Delete “${d.title}”?${extra} This can’t be undone.`)) return;
    try { await api('DELETE', `/docs/${d.id}`); data.owned = data.owned.filter((x) => x.id !== d.id); paint(); toast('Document deleted'); }
    catch (e) { toast(e.message, true); }
  }

  function row(d, shared) {
    const access = shared
      ? h('span', { class: 'tag shared' }, d.role === 'editor' ? 'Can edit' : 'View only')
      : d.sharedCount ? h('span', { class: 'tag shared' }, `Shared with ${d.sharedCount}`) : h('span', { class: 'tag' }, 'Only you');
    return h('a', { class: 'row' + (shared ? ' is-shared' : ''), href: `#/d/${d.id}` },
      h('div', { style: 'min-width:0' },
        h('div', { class: 'row-title' }, d.title),
        h('div', { class: 'row-preview' }, d.preview || 'Empty document')),
      h('div', { class: 'row-meta' }, shared ? `From ${d.owner.name}` : 'You'),
      h('div', { class: 'row-access' }, access, h('div', { class: 'row-meta', style: 'font-size:13px;margin-top:2px' }, ago(d.updatedAt))),
      shared ? h('span') : h('button', {
        class: 'icon-btn', title: 'Delete document', 'aria-label': `Delete ${d.title}`, svg: ICON.trash,
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); remove(d); },
      }));
  }

  function paint() {
    const items = [
      ...(tab !== 'shared' ? data.owned.map((d) => ({ d, s: false })) : []),
      ...(tab !== 'owned' ? data.shared.map((d) => ({ d, s: true })) : []),
    ].sort((a, b) => new Date(b.d.updatedAt) - new Date(a.d.updatedAt));
    tabs.replaceChildren(...[['all', 'All', data.owned.length + data.shared.length], ['owned', 'Owned by me', data.owned.length], ['shared', 'Shared with me', data.shared.length]]
      .map(([k, label, n]) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tab === k), onClick: () => { tab = k; paint(); } }, label, h('span', { class: 'count' }, n))));
    list.replaceChildren(...(items.length ? items.map(({ d, s }) => row(d, s)) : [
      h('div', { class: 'empty' },
        h('strong', {}, tab === 'shared' ? 'Nothing has been shared with you yet' : 'No documents yet'),
        tab === 'shared' ? 'When a teammate shares a document, it shows up here.' : 'Create a blank document or import a file to get started.')]));
  }

  paint();
  root.replaceChildren(topbar(), h('main', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h1', {}, 'Documents'),
      h('div', {},
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onClick: () => fileInput.click(), svg: undefined }, h('span', { svg: ICON.upload, style: 'display:inline-flex' }), 'Import file'),
          h('button', { class: 'btn primary', onClick: create }, 'New document')),
        h('p', { class: 'hint' }, 'Import supports .txt, .md and .docx up to 5 MB.'))),
    tabs, list, fileInput));
}

/* ---------- editor ---------- */
async function editorView(id) {
  root.replaceChildren(topbar(), h('p', { class: 'loading' }, 'Opening document…'));
  let doc;
  try { doc = await api('GET', `/docs/${id}`); }
  catch (e) {
    if (e.status === 401) return;
    root.replaceChildren(topbar(), h('main', { class: 'page' }, h('div', { class: 'empty' },
      h('strong', {}, e.status === 404 ? 'We can’t find that document' : 'Couldn’t open the document'),
      e.status === 404 ? 'It may have been deleted, or it hasn’t been shared with you.' : e.message,
      h('p', {}, h('a', { class: 'btn primary', href: '#/' }, 'Back to documents')))));
    return;
  }

  const canEdit = doc.role !== 'viewer';
  const isOwner = doc.role === 'owner';
  let base = doc.updatedAt;
  let dirty = { title: false, content: false };
  let saving = false, conflict = null, timer = null, retry = null;

  const status = h('span', { class: 'status', role: 'status' }, 'Saved');
  const setStatus = (t, bad = false) => { status.textContent = t; status.className = 'status' + (bad ? ' bad' : ''); };

  const title = h('input', {
    class: 'title-input', value: doc.title, 'aria-label': 'Document title', maxlength: '120', readonly: !canEdit || undefined,
    onInput: () => { dirty.title = true; schedule(); },
    onBlur: () => { if (!title.value.trim()) { title.value = 'Untitled document'; dirty.title = true; schedule(); } },
    onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } },
  });

  const editor = h('div', { class: 'doc', contenteditable: canEdit ? 'true' : 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document body', spellcheck: 'true' });
  editor.innerHTML = doc.content || '<p><br></p>';
  const words = h('span');
  const countWords = () => {
    const n = (editor.innerText.trim().match(/\S+/g) || []).length;
    words.textContent = `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`;
  };

  /* toolbar */
  const btns = {};
  const tbBtn = (key, label, icon, run) => {
    const b = h('button', { class: 'tb', type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false', disabled: !canEdit || undefined, svg: icon,
      onMouseDown: (e) => e.preventDefault(), onClick: () => { editor.focus(); run(); afterCmd(); } });
    btns[key] = b; return b;
  };
  const cmd = (c, v) => document.execCommand(c, false, v);
  const block = h('select', { class: 'style-select', 'aria-label': 'Text style', disabled: !canEdit || undefined,
    onChange: () => { editor.focus(); cmd('formatBlock', block.value); afterCmd(); } },
    h('option', { value: 'P' }, 'Body text'), h('option', { value: 'H1' }, 'Heading 1'), h('option', { value: 'H2' }, 'Heading 2'), h('option', { value: 'H3' }, 'Heading 3'));
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tbBtn('undo', 'Undo', ICON.undo, () => cmd('undo')), tbBtn('redo', 'Redo', ICON.redo, () => cmd('redo')),
    h('span', { class: 'sep' }), block, h('span', { class: 'sep' }),
    tbBtn('bold', 'Bold (Ctrl+B)', ICON.bold, () => cmd('bold')),
    tbBtn('italic', 'Italic (Ctrl+I)', ICON.italic, () => cmd('italic')),
    tbBtn('underline', 'Underline (Ctrl+U)', ICON.underline, () => cmd('underline')),
    h('span', { class: 'sep' }),
    tbBtn('ul', 'Bulleted list', ICON.ul, () => cmd('insertUnorderedList')),
    tbBtn('ol', 'Numbered list', ICON.ol, () => cmd('insertOrderedList')),
    tbBtn('quote', 'Quote', ICON.quote, () => {
      const cur = String(document.queryCommandValue('formatBlock')).toLowerCase();
      cmd('formatBlock', cur === 'blockquote' ? 'P' : 'BLOCKQUOTE');
    }));

  function syncToolbar() {
    if (!canEdit) return;
    const sel = document.getSelection();
    if (!sel.anchorNode || !editor.contains(sel.anchorNode)) return;
    for (const k of ['bold', 'italic', 'underline']) btns[k].setAttribute('aria-pressed', String(document.queryCommandState(k)));
    btns.ul.setAttribute('aria-pressed', String(document.queryCommandState('insertUnorderedList')));
    btns.ol.setAttribute('aria-pressed', String(document.queryCommandState('insertOrderedList')));
    const fb = String(document.queryCommandValue('formatBlock')).toLowerCase();
    btns.quote.setAttribute('aria-pressed', String(fb === 'blockquote'));
    block.value = ({ h1: 'H1', h2: 'H2', h3: 'H3' })[fb] || 'P';
  }
  function afterCmd() { dirty.content = true; schedule(); syncToolbar(); countWords(); }
  const onSel = () => syncToolbar();
  document.addEventListener('selectionchange', onSel);

  if (canEdit) {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    editor.addEventListener('input', () => { dirty.content = true; schedule(); countWords(); });
    // Paste as plain text: keeps stored HTML clean and predictable.
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); }
    });
  }

  /* saving */
  function schedule() {
    if (conflict) return;
    setStatus('Unsaved changes');
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }
  async function flush() {
    clearTimeout(timer); clearTimeout(retry);
    if (saving || conflict || (!dirty.title && !dirty.content)) return;
    saving = true;
    const sent = { ...dirty };
    const payload = { baseUpdatedAt: base };
    if (sent.title) payload.title = title.value.trim() || 'Untitled document';
    if (sent.content) payload.content = editor.innerHTML;
    dirty = { title: false, content: false };
    setStatus('Saving…');
    try {
      const r = await api('PATCH', `/docs/${id}`, payload);
      base = r.updatedAt;
    } catch (e) {
      saving = false;
      dirty = { title: dirty.title || sent.title, content: dirty.content || sent.content };
      if (e.status === 409) return showConflict(e.data.current);
      if (e.status === 401) return;
      if (e.network) { setStatus('Offline. Retrying…', true); retry = setTimeout(flush, 3000); return; }
      setStatus('Couldn’t save', true); toast(e.message, true);
      return;
    }
    saving = false;
    if (dirty.title || dirty.content) return flush();
    setStatus('Saved');
  }

  const bannerSlot = h('div');
  function showConflict(cur) {
    conflict = cur;
    setStatus('Not saved', true);
    bannerSlot.replaceChildren(h('div', { class: 'banner warn', role: 'alert' },
      h('span', {}, `${cur.updatedBy || 'Someone'} saved a newer version. Your latest changes haven’t been saved.`),
      h('span', { style: 'display:flex;gap:8px' },
        h('button', { class: 'btn', onClick: async () => { await loadRemote(); } }, 'Load their version'),
        h('button', { class: 'btn primary', onClick: () => { base = cur.updatedAt; conflict = null; bannerSlot.replaceChildren(); dirty = { title: true, content: true }; flush(); } }, 'Keep mine'))));
  }
  async function loadRemote(quiet) {
    try {
      const r = await api('GET', `/docs/${id}`);
      editor.innerHTML = r.content || '<p><br></p>';
      title.value = r.title;
      base = r.updatedAt; conflict = null; dirty = { title: false, content: false };
      bannerSlot.replaceChildren();
      setStatus('Saved'); countWords();
      if (quiet) toast(`${r.updatedBy || 'Someone'} updated this document`);
    } catch (e) { toast(e.message, true); }
  }

  // Pick up teammates' edits when this tab has nothing unsaved.
  const poll = setInterval(async () => {
    if (document.hidden || saving || conflict || dirty.title || dirty.content) return;
    try {
      const r = await api('GET', `/docs/${id}`);
      if (r.updatedAt !== base && !dirty.title && !dirty.content && !saving) {
        editor.innerHTML = r.content || '<p><br></p>';
        title.value = r.title; base = r.updatedAt; countWords();
        toast(`${r.updatedBy || 'Someone'} updated this document`);
      }
    } catch (e) { if (e.status === 404) { toast('This document is no longer available', true); location.hash = '#/'; } }
  }, 5000);

  const warn = (e) => { if (dirty.title || dirty.content || saving) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  teardown = () => {
    clearInterval(poll); clearTimeout(timer); clearTimeout(retry);
    document.removeEventListener('selectionchange', onSel);
    window.removeEventListener('beforeunload', warn);
    if (dirty.title || dirty.content) { flush(); } // best effort on in-app navigation
  };

  const right = h('div', { style: 'display:flex;align-items:center;gap:10px' },
    !canEdit && h('span', { class: 'tag shared' }, 'View only'),
    canEdit && !isOwner && h('span', { class: 'tag shared' }, `Shared by ${doc.owner.name}`),
    status,
    isOwner && h('button', { class: 'btn', onClick: () => openShare(doc) }, 'Share'));
  const back = h('a', { class: 'btn quiet', href: '#/', 'aria-label': 'Back to documents' }, '← Documents');

  root.replaceChildren(
    h('header', { class: 'bar ed-bar' },
      h('a', { class: 'wordmark', href: '#/', style: 'margin-right:4px' }, 'Ajaia ', h('span', {}, 'Docs')),
      back, title, h('div', { class: 'grow' }), right,
      h('span', { class: 'avatar', title: state.user.name, 'aria-label': `Signed in as ${state.user.name}` }, initials(state.user.name))),
    toolbar, bannerSlot,
    h('main', { class: 'canvas' }, h('article', { class: 'paper' }, editor)),
    h('footer', { class: 'foot' }, words,
      h('span', {}, doc.updatedBy ? `Last edited by ${doc.updatedBy}` : `Owned by ${doc.owner.name}`)));
  countWords();
  if (canEdit && doc.title === 'Untitled document') { title.focus(); title.select(); }
}

/* ---------- share dialog ---------- */
async function openShare(doc) {
  const dlg = h('dialog', { 'aria-labelledby': 'share-title' });
  const err = h('p', { class: 'error', role: 'alert' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'teammate@ajaia.test', 'aria-label': 'Email address', autocomplete: 'off' });
  const role = h('select', { class: 'input', 'aria-label': 'Access level', style: 'padding:0 8px' },
    h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'View only'));
  const people = h('ul', { class: 'people' });
  let data;

  const roleSelect = (p) => {
    const s = h('select', { 'aria-label': `Access for ${p.name}`,
      onChange: async () => {
        try { await api('POST', `/docs/${doc.id}/shares`, { email: p.email, role: s.value }); p.role = s.value; toast('Access updated'); }
        catch (e) { s.value = p.role; toast(e.message, true); }
      } },
      h('option', { value: 'editor' }, 'Can edit'), h('option', { value: 'viewer' }, 'View only'));
    s.value = p.role; return s;
  };
  function paint() {
    people.replaceChildren(
      h('li', { class: 'person' }, h('span', { class: 'avatar' }, initials(data.owner.name)),
        h('span', {}, `${data.owner.name} (you)`, h('small', {}, data.owner.email)), h('span', { class: 'tag' }, 'Owner'), h('span')),
      ...data.people.map((p) => h('li', { class: 'person' },
        h('span', { class: 'avatar' }, initials(p.name)),
        h('span', {}, p.name, h('small', {}, p.email)),
        roleSelect(p),
        h('button', { class: 'btn quiet', style: 'height:32px;padding:0 8px', 'aria-label': `Remove ${p.name}`, onClick: async () => {
          try { await api('DELETE', `/docs/${doc.id}/shares/${p.userId}`); data.people = data.people.filter((x) => x.userId !== p.userId); paint(); }
          catch (e) { err.textContent = e.message; }
        } }, 'Remove'))));
  }
  const add = async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!email.value.trim()) { err.textContent = 'Enter a teammate’s email.'; return; }
    try {
      const p = await api('POST', `/docs/${doc.id}/shares`, { email: email.value, role: role.value });
      const i = data.people.findIndex((x) => x.userId === p.userId);
      if (i >= 0) data.people[i] = p; else data.people.push(p);
      email.value = ''; paint(); toast(`Shared with ${p.name}`);
    } catch (ex) { err.textContent = ex.message; }
  };

  dlg.append(h('div', { class: 'dlg' },
    h('h2', { id: 'share-title' }, `Share “${doc.title}”`),
    h('p', { class: 'sub' }, 'People you add can open this document from their Shared with me tab.'),
    h('form', { class: 'add-row', onSubmit: add, novalidate: true }, email, role, h('button', { class: 'btn primary', type: 'submit' }, 'Share')),
    err, people,
    h('div', { class: 'dlg-foot' }, h('button', { class: 'btn', onClick: () => dlg.close() }, 'Done'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  try { data = await api('GET', `/docs/${doc.id}/shares`); paint(); }
  catch (e) { err.textContent = e.message; }
}

/* ---------- router ---------- */
async function render() {
  teardown(); teardown = () => {};
  const hash = location.hash || '#/';
  if (!state.user && hash !== '#/login') { location.hash = '#/login'; return; }
  if (state.user && hash === '#/login') { location.hash = '#/'; return; }
  document.title = 'Ajaia Docs';
  if (hash === '#/login') return loginView();
  const m = hash.match(/^#\/d\/([\w-]+)$/);
  if (m) return editorView(m[1]);
  return libraryView();
}

window.addEventListener('hashchange', render);
(async () => {
  try { state.user = (await api('GET', '/me')).user; } catch { state.user = null; }
  render();
})();
