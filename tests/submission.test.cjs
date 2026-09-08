const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="\.\/(.*?)"[^>]*><\/script>/g)].map((m) => m[1]);
const coreKey = 'meal-planner.webmcp.v1';
const snapshot = (value) => JSON.parse(JSON.stringify(value));

// Minimal DOM adapter for executing the actual classic scripts in Node.
// This verifies state/tool contracts, not browser layout or native WebMCP support.
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.value = ''; this.textContent = '';
    this.listeners = {}; this.attributes = {}; this.className = '';
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  append(...items) { this.children.push(...items); }
  prepend(...items) { this.children.unshift(...items); }
  replaceChildren(...items) { this.children = items; }
  before() {} remove() {} click() {} focus() {} close() {} showModal() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
}
async function app({ stored = {}, failRegistration = '', discovery = true, available = true } = {}) {
  const storage = new Map(Object.entries(stored));
  const elements = new Map();
  const listeners = new Map();
  const registered = new Map();
  const attempts = [];
  const errors = [];
  let blocked = false;
  const document = {
    body: new Element(), head: new Element(),
    createElement: () => new Element(),
    querySelector(selector) {
      if (selector === '#importButton' && !elements.has('installedImport')) return null;
      if (selector === '#shoppingPriceControls' && !elements.has('installedPricing')) return null;
      if (!elements.has(selector)) elements.set(selector, new Element());
      const el = elements.get(selector); el.parentElement ||= new Element(); return el;
    },
    querySelectorAll: () => [],
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); }
  };
  if (available) document.modelContext = {
    async registerTool(tool) {
      attempts.push(tool.name);
      if (tool.name === failRegistration) throw new Error('Simulated registration failure');
      if (registered.has(tool.name)) throw new Error('Duplicate registration');
      registered.set(tool.name, tool);
    },
    ...(discovery ? { async getTools() { return [...registered.values()]; } } : {}),
    addEventListener() {}
  };
  const context = vm.createContext({
    document, console: { error: (...args) => errors.push(args), debug() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) { if (blocked) throw new Error('Quota exceeded'); storage.set(key, value); },
      removeItem(key) { if (blocked) throw new Error('Storage denied'); storage.delete(key); }
    },
    navigator: {}, URL, Intl, Date, Event, crypto: require('node:crypto').webcrypto,
    setTimeout: () => 0, clearTimeout() {}, queueMicrotask, Option: Element,
    alert() {}, confirm: () => true
  });
  context.window = context;
  for (const file of scripts) vm.runInContext(readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise(setImmediate);
  async function call(name, input = {}) {
    assert.ok(registered.has(name), `Tool not registered: ${name}`);
    return snapshot(await registered.get(name).execute(input));
  }
  async function data(name, input = {}) {
    const result = await call(name, input);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true, parsed.error);
    return parsed.data;
  }
  return { context, storage, registered, attempts, errors, call, data, block: (value) => { blocked = value; }, status: () => elements.get('#mcpStatus') };
}
const recipe = { name: 'Test recipe', servings: 2, prep_minutes: 5, cook_minutes: 10, tags: [], ingredients: [{ name: 'Beans', quantity: 400, unit: 'g' }], instructions: ['Cook until ready.'] };
const quote = { ingredient: 'Beans', store: 'Store A', package_quantity: 300, package_unit: 'g', price: 3, location: '', promotion: '', valid_until: '', source_url: 'https://example.test/item' };
async function seed(a) {
  const r = await a.data('save_recipe', recipe);
  const period = vm.runInContext('currentWeekRange()', a.context);
  await a.data('plan_meal', { date: period.start_date, meal_type: 'dinner', recipe_id: r.id, servings: 4 });
  return { r, period };
}

test('all documented tools register exactly once from the scripts referenced in HTML', async () => {
  assert.equal(new Set(scripts).size, scripts.length);
  for (const file of scripts) assert.ok(existsSync(path.join(root, file)));
  const a = await app();
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const section = readme.split('## WebMCP')[1].split('## Architecture')[0];
  const documented = [...section.matchAll(/^- `([a-z_]+)`$/gm)].map((m) => m[1]).sort();
  assert.equal(documented.length, 25);
  assert.deepEqual([...a.registered.keys()].sort(), documented);
  assert.equal(a.attempts.length, 25);
  assert.equal(a.errors.length, 0);
  assert.equal(a.status().textContent, 'WebMCP · 25 tools');
  assert.ok(!readFileSync(path.join(root, 'recipe-view.js'), 'utf8').includes('shopping-localization.js'));
});
test('status reports registration failure and works without discovery or WebMCP', async () => {
  const failed = await app({ failRegistration: 'save_source' });
  assert.equal(failed.status().textContent, 'WebMCP · 24/25 tools');
  const fallback = await app({ discovery: false });
  assert.equal(fallback.status().textContent, 'WebMCP · 25 tools');
  assert.match(fallback.status().title, /discovery is unavailable/);
  const plain = await app({ available: false });
  assert.equal(plain.status().textContent, 'WebMCP unavailable');
});
test('scaling, pantry subtraction, plan atomicity and invalid dates', async () => {
  const a = await app(); const { r, period } = await seed(a);
  await a.data('set_pantry_item', { name: ' beans ', quantity: 100, unit: 'g' });
  assert.equal((await a.data('build_shopping_list', period))[0].buyQuantity, 700);
  assert.equal((await a.data('get_recipe', { recipe_id: r.id, servings: 1 })).ingredients[0].quantity, 200);
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-01', 'garbage']) {
    assert.equal((await a.call('plan_meal', { date, meal_type: 'dinner', recipe_id: r.id, servings: 1 })).isError, true);
  }
  const before = await a.data('export_meal_data');
  const bad = await a.call('plan_meals', { meals: [{ date: period.start_date, meal_type: 'lunch', recipe_id: r.id, servings: 1 }, { date: period.start_date, meal_type: 'dinner', recipe_id: 'missing', servings: 1 }] });
  assert.equal(bad.isError, true);
  assert.deepEqual(await a.data('export_meal_data'), before);
  assert.equal((await a.call('save_recipe', { ...recipe, instructions: [' '] })).isError, true);
  assert.equal((await a.call('save_recipe', { ...recipe, ingredients: [{ name: 'Beans', quantity: 'oops', unit: 'g' }] })).isError, true);
});
test('recipe/plan deletion, pantry removal and export/import round trip', async () => {
  const a = await app(); const { r, period } = await seed(a);
  const saved = await a.data('export_meal_data');
  await a.data('delete_recipe', { recipe_id: r.id });
  assert.equal((await a.data('get_meal_plan', period)).length, 0);
  await a.data('import_meal_data', { data: saved });
  assert.equal((await a.data('list_recipes')).length, 1);
  await a.data('remove_meal', { date: period.start_date, meal_type: 'dinner' });
  await a.data('plan_meals', { meals: [{ date: period.start_date, meal_type: 'lunch', recipe_id: r.id, servings: 2 }] });
  await a.data('set_pantry_item', { name: 'Beans', quantity: 1, unit: 'g' });
  await a.data('set_pantry_item', { name: 'Beans', quantity: 0, unit: 'g' });
  assert.equal((await a.data('list_pantry')).length, 0);
  assert.equal((await a.data('meal_context', period)).mealPlan.length, 1);
  const invalid = snapshot(saved); invalid.plans[0].recipeId = 'missing';
  assert.equal((await a.call('import_meal_data', { data: invalid })).isError, true);
});
test('failed writes roll back core, import, Sources, Profile and pricing', async () => {
  const a = await app(); const { r } = await seed(a);
  const before = await a.data('export_meal_data');
  a.block(true);
  assert.equal((await a.call('save_recipe', recipe)).isError, true);
  assert.deepEqual(await a.data('export_meal_data'), before);
  assert.equal((await a.call('import_meal_data', { data: { version: 1, recipes: [], plans: [], pantry: [] } })).isError, true);
  assert.deepEqual(await a.data('export_meal_data'), before);
  assert.equal((await a.call('save_source', { title: 'Reference', url: 'https://example.test/recipe', type: 'article', recipe_id: r.id })).isError, true);
  assert.equal((await a.data('list_sources')).length, 0);
  assert.equal((await a.call('set_preferences', { household_size: 2 })).isError, true);
  assert.equal((await a.data('get_preferences')).householdSize, null);
  assert.equal((await a.call('set_shopping_profile', { location: '', preferred_stores: [], currency: 'XTS' })).isError, true);
  assert.equal((await a.data('shopping_price_context')).currency, 'XXX');
});
test('Profile partial updates, source validation and persistence across reload', async () => {
  const a = await app(); const { r } = await seed(a);
  await a.data('set_preferences', { household_size: 2, allergies: ['peanuts'] });
  await a.data('set_preferences', { goals: ['meal prep'] });
  assert.deepEqual((await a.data('get_preferences')).allergies, ['peanuts']);
  assert.equal((await a.call('set_preferences', { household_size: 1.5 })).isError, true);
  for (const url of ['javascript:alert(1)', 'bad url', 'https://user:password@example.test/']) {
    assert.equal((await a.call('save_source', { title: 'Reference', url, type: 'article' })).isError, true);
  }
  const source = await a.data('save_source', { title: 'Reference', url: 'https://example.test/recipe', type: 'article', recipe_id: r.id });
  const b = await app({ stored: Object.fromEntries(a.storage) });
  assert.equal((await b.data('list_sources'))[0].recipeId, r.id);
  assert.equal((await b.data('get_preferences')).householdSize, 2);
  assert.equal((await b.data('list_recipes')).length, 1);
  await b.data('delete_source', { source_id: source.id });
  assert.equal((await b.data('list_sources')).length, 0);
});
test('package costs, quote batch atomicity, expiry, clearing and currency changes', async () => {
  const a = await app(); await seed(a);
  assert.equal((await a.call('save_price_quotes', { quotes: [quote] })).isError, true);
  await a.data('set_shopping_currency', { currency: 'XTS' });
  await a.data('save_price_quotes', { quotes: [quote] });
  const priced = await a.data('priced_shopping_list');
  assert.equal(priced.total, 9); assert.equal(priced.items[0].estimate.packages, 3);
  const before = await a.data('shopping_price_context');
  assert.equal((await a.call('save_price_quotes', { quotes: [{ ...quote, price: 1 }, { ...quote, price: -1 }] })).isError, true);
  assert.deepEqual(await a.data('shopping_price_context'), before);
  await a.data('save_price_quotes', { quotes: [{ ...quote, valid_until: '2000-01-01' }] });
  assert.equal((await a.data('priced_shopping_list')).pricedCount, 0);
  await a.data('save_price_quotes', { quotes: [quote] });
  await a.data('set_shopping_profile', { location: '', preferred_stores: [], currency: 'XXX' });
  assert.equal((await a.data('shopping_price_context')).savedQuotes.length, 0);
  await a.data('set_shopping_currency', { currency: 'XTS' });
  await a.data('save_price_quotes', { quotes: [quote] });
  await a.data('clear_price_quotes');
  assert.equal((await a.data('priced_shopping_list')).pricedCount, 0);
});
test('malformed saved state cannot crash startup or be silently overwritten', async () => {
  const stored = {
    [coreKey]: JSON.stringify({ version: 1, recipes: [null], plans: [], pantry: [] }),
    'meal-planner.sources.v1': JSON.stringify({ version: 1, sources: [null] }),
    'meal-planner.preferences.v1': JSON.stringify({ version: 1, budget: { amount: -2 } }),
    'meal-planner.shopping-pricing.v1': JSON.stringify({ quotes: [null] })
  };
  const a = await app({ stored });
  assert.equal(a.registered.size, 25);
  assert.equal((await a.call('save_recipe', recipe)).isError, true);
  assert.deepEqual(Object.fromEntries(a.storage), stored);
  await a.data('import_meal_data', { data: { version: 1, recipes: [], plans: [], pantry: [] } });
  await a.data('save_recipe', recipe);
  assert.equal((await a.data('list_recipes')).length, 1);
});
