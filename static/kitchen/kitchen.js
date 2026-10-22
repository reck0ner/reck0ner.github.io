import { config } from './config.js';

const $ = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).get('demo') === '1';
const categories = ['Fridge', 'Pantry', 'Spices'];
const themeKey = 'our-kitchen-theme';
const themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
let savedTheme = null;
try {
  const value = localStorage.getItem(themeKey);
  if (value === 'dark' || value === 'light') savedTheme = value;
} catch {}
function applyTheme() {
  const dark = (savedTheme || (themeMedia?.matches ? 'dark' : 'light')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const button = $('theme-toggle');
  button.textContent = dark ? '☀' : '☾';
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.setAttribute('aria-pressed', String(dark));
  button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171e1b' : '#285647');
}
applyTheme();
$('theme-toggle').onclick = () => {
  savedTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(themeKey, savedTheme); } catch {}
  applyTheme();
};
themeMedia?.addEventListener?.('change', () => { if (!savedTheme) applyTheme(); });
let items = [], filter = 'All', writing = false, writable = false, editing = null;
let widget, token = '', pendingAdd = null;
let formChallengePromise, formTokenWaiter;
let turnstileLoading, quickWidget, quickToken = '', quickWaiter;
let quickSession = null;
let inventoryRevision = 0;
const snapshotKey = `our-kitchen-inventory-v1:${location.origin}${config.apiPath}`;
let itemState = null;
function validItem(x) {
  return x && typeof x.id === 'string' && typeof x.name === 'string' &&
    Number.isFinite(x.quantity) && x.quantity >= 0 && x.quantity <= 9999 &&
    typeof x.unit === 'string' && categories.includes(x.location) &&
    typeof x.expiry === 'string' && typeof x.version === 'string';
}
function saveSnapshot() {
  if (demo) return;
  try { localStorage.setItem(snapshotKey, JSON.stringify({items, writable, savedAt: Date.now()})); } catch {}
}
function showSnapshot() {
  if (demo) return;
  try {
    const data = JSON.parse(localStorage.getItem(snapshotKey));
    if (!data || !Array.isArray(data.items) || data.items.length > 500 || !data.items.every(validItem) ||
        !Number.isFinite(data.savedAt) || data.savedAt > Date.now() || Date.now() - data.savedAt > 30 * 86400000) return;
    items = data.items;
    // The version check on writes protects changes made since this snapshot.
    writable = data.writable === true && Boolean(config.turnstileSiteKey) && navigator.onLine !== false;
    $('sync').textContent = `Showing saved list from ${new Date(data.savedAt).toLocaleString()} · checking for updates…`;
    render();
  } catch {}
}
const sample = [
  ['Greek yogurt', 2, 'Fridge', '2026-10', 'tubs'], ['Free-range eggs', 6, 'Fridge', '2026-11', ''],
  ['Basmati rice', 1.5, 'Pantry', '2027-03', 'kg'], ['Cherry tomatoes', 250, 'Fridge', '', 'g'],
  ['Smoked paprika', 1, 'Spices', '2026-09', 'jar'], ['Oat milk', 0, 'Pantry', '2026-12', 'L'],
  ['Ground cumin', 1, 'Spices', '2027-02', 'jar'], ['Chickpeas', 3, 'Pantry', '2027-08', 'tins'],
  ['Baby spinach', 200, 'Fridge', '2026-10', 'g'],
].map(([name, quantity, location, expiry, unit], i) => ({id: `sample-${i}`, name, quantity, location, expiry, unit, version: `v${i}`}));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function monthNow() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function expiryText(value, verbose = false) {
  if (!value) return '';
  const [year, month] = value.split('-').map(Number);
  const label = new Intl.DateTimeFormat('en', {month: 'short', year: 'numeric'}).format(new Date(year, month - 1, 1));
  return verbose ? `${value < monthNow() ? 'Past expiry month · ' : value === monthNow() ? 'This month · ' : 'Expires '}${label}` : label;
}
function render() {
  $('total').textContent = items.filter(x => x.quantity > 0).length;
  $('soon').textContent = items.filter(x => x.quantity > 0 && x.expiry === monthNow()).length;
  $('expired').textContent = items.filter(x => x.quantity > 0 && x.expiry && x.expiry < monthNow()).length;
  document.querySelectorAll('[data-filter]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    b.querySelector('span').textContent = items.filter(x => b.dataset.filter === 'All' || x.location === b.dataset.filter).length;
  });
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = items.filter(x => (filter === 'All' || x.location === filter) && x.name.toLocaleLowerCase().includes(query));
  $('items').replaceChildren(...visible.map(item => {
    const card = el('article', 'item');
    const icon = el('span', 'item-icon', {Fridge: '❄', Pantry: '♧', Spices: '✳'}[item.location]);
    icon.setAttribute('aria-hidden', 'true');
    const name = el('h3', '', item.name);
    name.title = item.name;
    const meta = el('div', 'item-meta');
    const dueClass = item.expiry && item.expiry < monthNow() ? 'past' : item.expiry === monthNow() ? 'due' : '';
    const expiry = el('span', `expiry ${dueClass}`, expiryText(item.expiry));
    if (item.expiry) expiry.setAttribute('aria-label', expiryText(item.expiry, true));
    meta.append(expiry, el('span', 'location', item.location));
    const bottom = el('div', 'item-bottom');
    bottom.append(icon);
    const controls = el('div', 'quantity-control');
    for (const [label, text, target] of [
      [`Reduce ${item.name} by one`, '−', Math.max(0, Math.round((item.quantity - 1) * 100) / 100)],
      [`Edit quantity for ${item.name}, currently ${item.quantity} ${item.unit}`, `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`, null],
      [`Increase ${item.name} by one`, '+', Math.round((item.quantity + 1) * 100) / 100],
    ]) {
      const b = el('button', target === null ? 'quantity-value' : '', text);
      b.setAttribute('aria-label', label);
      b.disabled = !writable || (writing && (quickSession?.id !== item.id || target === null)) ||
        target > 9999 || (text === '−' && item.quantity === 0);
      b.dataset.item = item.id;
      b.dataset.direction = text === '−' ? 'minus' : text === '+' ? 'plus' : 'edit';
      b.onclick = () => target !== null && Number.isInteger(item.quantity)
        ? quickChange(item, target, b.dataset.direction) : openEditor(item, target);
      controls.append(b);
    }
    bottom.append(controls);
    card.append(name, meta, bottom);
    if (itemState?.id === item.id) {
      const status = el('p', `item-status ${itemState.kind}`, itemState.text);
      status.setAttribute('role', 'status');
      card.append(status);
    }
    return card;
  }));
  $('empty').hidden = visible.length !== 0;
  $('empty').querySelector('h3').textContent = query ? 'No matching ingredients' : 'Nothing on this shelf yet';
  $('empty').querySelector('p').textContent = query ? 'Try another search or choose a different shelf.' : 'Add an item to get started.';
  $('add-open').disabled = !writable || writing;
  $('refresh').disabled = writing;
}
async function api(body) {
  const response = await fetch(config.apiPath, {
    method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Kitchen service is not connected yet. Please try again later.'); }
  if (!response.ok || !data.ok) {
    const messages = {
      busy: 'The Telegram bot is updating the kitchen. Wait a moment, then try again.',
      conflict: 'This item changed since you opened it. Refresh the kitchen and try again.',
      rate_limited: 'Too many requests. Please wait a minute before trying again.',
      daily_limit: 'The kitchen reached its daily safety limit. Please try again tomorrow.',
      challenge: 'Please complete the verification again before saving.',
      read_only: 'The kitchen is temporarily read-only.',
      configuration: 'The kitchen connection needs attention from its owner.',
      invalid: 'Please check the item name, quantity, category, and expiry.',
      not_found: 'This item is no longer in the sheet. Refresh the kitchen.',
      capacity: 'The kitchen is full. Its owner needs to archive old rows in the sheet.',
    };
    const error = new Error(messages[data.error] || 'The kitchen could not confirm this request. Refresh before making another change.');
    error.code = data.error;
    throw error;
  }
  return data;
}
async function load() {
  if (writing) return;
  const revision = inventoryRevision;
  $('refresh').disabled = true;
  $('items').setAttribute('aria-busy', 'true');
  $('message').textContent = '';
  try {
    const data = demo ? {items: items.length ? items : structuredClone(sample), writable: true} : await api();
    if (revision !== inventoryRevision) return;
    if (!Array.isArray(data.items)) throw new Error('The kitchen returned an unexpected response.');
    items = data.items;
    writable = data.writable && (demo || Boolean(config.turnstileSiteKey));
    itemState = null;
    saveSnapshot();
    $('sync').textContent = demo ? 'Sample kitchen · preview only' : `Updated ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
    if (!writable) $('message').textContent = 'Viewing only. Public editing has not been enabled by the owner.';
    render();
    if (writable && !demo) prepareQuick().catch(() => {});
  } catch (error) {
    if (revision !== inventoryRevision) return;
    writable = false;
    $('message').textContent = error.message;
    $('sync').textContent = items.length ? 'Connection lost · showing last loaded items' : 'Not connected';
    render();
    if (!items.length) $('empty').hidden = true;
  } finally {
    $('items').setAttribute('aria-busy', 'false');
    $('refresh').disabled = writing;
  }
}

async function ensureTurnstile() {
  if (window.turnstile) return;
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const timer = setTimeout(() => reject(new Error('Verification could not load. Check your connection and try again.')), 12000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Verification could not load. Please reopen this form.')); };
      document.head.append(script);
    }).catch(error => { turnstileLoading = undefined; throw error; });
  }
  await turnstileLoading;
}
async function prepareQuick() {
  await ensureTurnstile();
  if (quickWidget !== undefined) return;
  quickWidget = window.turnstile.render('#quick-challenge', {
    sitekey: config.turnstileSiteKey, action: 'kitchen-write', size: 'flexible',
    appearance: 'interaction-only',
    callback: value => { quickToken = value; if (quickWaiter) quickWaiter.resolve(value); },
    'expired-callback': () => { quickToken = ''; },
    'error-callback': () => {
      quickToken = '';
      if (quickWaiter) quickWaiter.reject(new Error('Verification failed. Please refresh and try again.'));
    },
  });
}
async function getQuickToken() {
  if (demo) return '';
  await prepareQuick();
  if (quickToken) return quickToken;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { quickWaiter = undefined; reject(new Error('Verification took too long. Please try again.')); }, 30000);
    quickWaiter = {
      resolve: value => { clearTimeout(timer); quickWaiter = undefined; resolve(value); },
      reject: error => { clearTimeout(timer); quickWaiter = undefined; reject(error); },
    };
    window.turnstile.reset(quickWidget);
  });
}
function remember(item) {
  const index = items.findIndex(x => x.id === item.id);
  if (index < 0) items.push(item); else items[index] = item;
}
async function quickChange(item, quantity, direction) {
  if (!writable) return;
  if (quickSession?.id === item.id) {
    quickSession.desired = quantity;
    remember({...item, quantity});
    render();
    return;
  }
  if (writing) return;
  writing = true;
  inventoryRevision++;
  quickSession = {id: item.id, desired: quantity};
  let confirmed = item;
  remember({...item, quantity});
  itemState = {id: item.id, kind: 'pending', text: 'Saving…'};
  $('message').textContent = '';
  $('sync').textContent = `Saving ${item.name}…`;
  render();
  try {
    while (true) {
      const nextQuantity = quickSession.desired;
      const turnstileToken = await getQuickToken();
      const data = demo ? {item: {...confirmed, quantity: nextQuantity, version: crypto.randomUUID()}}
        : await api({action: 'setQuantity', id: item.id, quantity: nextQuantity,
          version: confirmed.version, turnstileToken});
      confirmed = data.item;
      quickToken = '';
      if (quickSession.desired === nextQuantity) break;
    }
    remember(confirmed);
    itemState = {id: item.id, kind: 'saved', text: 'Saved'};
    saveSnapshot();
    $('sync').textContent = demo ? 'Preview updated · not saved to the sheet' : 'Saved to the shared kitchen';
  } catch (error) {
    remember(confirmed);
    saveSnapshot();
    writable = false;
    itemState = {id: item.id, kind: error.code === 'conflict' ? 'conflict' : 'error',
      text: error.code === 'conflict' ? 'Changed elsewhere' : 'Save not confirmed'};
    $('message').textContent = `${error.message} Wait a few seconds, then refresh to check the current quantity before editing again.`;
    $('sync').textContent = error.code === 'conflict' ? 'Quantity conflict' : 'Change not confirmed';
  } finally {
    writing = false;
    quickSession = null;
    quickToken = '';
    if (!demo && quickWidget !== undefined) window.turnstile.reset(quickWidget);
    render();
    document.querySelector(`button[data-item="${CSS.escape(item.id)}"][data-direction="${direction}"]`)?.focus({preventScroll:true});
  }
}
async function challenge() {
  if (demo) return;
  token = '';
  await ensureTurnstile();
  if (!$('editor').open) return;
  if (widget !== undefined) window.turnstile.remove(widget);
  widget = window.turnstile.render('#challenge', {
    sitekey: config.turnstileSiteKey, action: 'kitchen-write', size: 'flexible',
    callback: value => { token = value; formTokenWaiter?.resolve(value); },
    'expired-callback': () => {
      token = '';
      if (widget !== undefined) window.turnstile.reset(widget);
    },
    'error-callback': () => {
      token = '';
      formTokenWaiter?.reject(new Error('Verification failed. Close and reopen this form to try again.'));
    },
  });
}
async function getFormToken() {
  if (demo) return '';
  if (formChallengePromise && !await formChallengePromise) throw new Error('Verification could not load. Close and reopen this form.');
  if (token) return token;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { formTokenWaiter = null; reject(new Error('Verification took too long. Close and reopen this form.')); }, 30000);
    formTokenWaiter = {
      resolve: value => { clearTimeout(timer); formTokenWaiter = null; resolve(value); },
      reject: error => { clearTimeout(timer); formTokenWaiter = null; reject(error); },
    };
  });
}
function openEditor(item = null, target = null) {
  editing = item;
  pendingAdd = null;
  $('item-form').reset();
  $('form-error').textContent = '';
  $('editor-title').textContent = item ? 'A little stock check' : 'Add to the kitchen';
  $('edit-name').textContent = item ? `${item.name}${item.unit ? ` · ${item.unit}` : ''}` : '';
  $('add-fields').hidden = Boolean(item);
  $('name').required = !item;
  $('name').maxLength = 150;
  $('unit-label').hidden = Boolean(item);
  $('quantity-row').classList.toggle('quantity-only', Boolean(item));
  $('expiry-help').hidden = Boolean(item);
  $('unit').value = item ? item.unit : '';
  $('unit').disabled = Boolean(item);
  $('expiry-label').hidden = Boolean(item);
  $('expiry').disabled = Boolean(item);
  $('quantity').value = item ? (target ?? item.quantity) : 1;
  $('location').value = categories.includes(filter) ? filter : 'Pantry';
  $('save').textContent = item ? 'Save quantity' : 'Add item';
  $('save').disabled = false;
  $('editor').showModal();
  (item ? $('quantity') : $('name')).focus();
  formChallengePromise = challenge().then(() => true).catch(error => {
    $('form-error').textContent = error.message;
    return false;
  });
}
$('item-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (writing) return;
  const quantity = Number($('quantity').value);
  const unit = $('unit').value.trim();
  const name = $('name').value.trim();
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 9999 || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-7 || (!editing && (!name || name.length > 150))) {
    $('form-error').textContent = 'Use a name up to 150 characters and a quantity from 0 to 9999, with up to two decimal places.';
    return;
  }
  const payload = editing
    ? {action: 'setQuantity', id: editing.id, quantity, version: editing.version}
    : {action: 'add', name, quantity, unit, location: $('location').value, expiry: $('expiry').value};
  const signature = JSON.stringify(payload);
  if (!editing) {
    if (!pendingAdd || pendingAdd.signature !== signature) pendingAdd = {signature, id: crypto.randomUUID()};
    payload.id = pendingAdd.id;
  }
  writing = true;
  inventoryRevision++;
  const original = editing;
  if (editing) {
    remember({...editing, quantity});
    itemState = {id: editing.id, kind: 'pending', text: 'Saving…'};
  }
  $('save').disabled = true;
  $('close-editor').disabled = true;
  $('form-error').textContent = 'Saving…';
  render();
  try {
    let data;
    if (demo) {
      const item = editing ? {...editing, quantity, version: crypto.randomUUID()} : {...payload, version: crypto.randomUUID()};
      data = {item};
    } else data = await api({...payload, turnstileToken: await getFormToken()});
    remember(data.item);
    if (editing) itemState = {id: editing.id, kind: 'saved', text: 'Saved'};
    saveSnapshot();
    $('editor').close();
    $('message').textContent = '';
    $('sync').textContent = demo ? 'Preview updated · not saved to the sheet' : 'Saved to the shared kitchen';
  } catch (error) {
    if (original) {
      remember(original);
      writable = false;
      itemState = {id: original.id, kind: error.code === 'conflict' ? 'conflict' : 'error',
        text: error.code === 'conflict' ? 'Changed elsewhere' : 'Save not confirmed'};
    }
    $('form-error').textContent = `${error.message} Close this form, wait a few seconds, then refresh to check the current quantity before editing again.`;
    if (!demo && widget !== undefined) window.turnstile.reset(widget);
  } finally {
    token = '';
    writing = false;
    $('close-editor').disabled = false;
    $('save').disabled = false;
    render();
  }
});
$('editor').addEventListener('cancel', event => { if (writing) event.preventDefault(); });
$('editor').addEventListener('close', () => {
  token = '';
  if (widget !== undefined) { window.turnstile.remove(widget); widget = undefined; }
});
$('close-editor').onclick = () => $('editor').close();
$('add-open').onclick = () => openEditor();
$('refresh').onclick = load;
$('search').oninput = render;
document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => { filter = button.dataset.filter; render(); }; });
showSnapshot();
load();

if (!demo && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', {scope: '/kitchen/', updateViaCache: 'none'})
    .then(registration => registration.update()).catch(() => {});
}
