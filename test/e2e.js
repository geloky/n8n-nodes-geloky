'use strict';

/**
 * End-to-end test: the built node inside a real n8n (Docker), against a Geloky with local
 * test keys. Every lookup is billed to the key used.
 *
 *   npm run build
 *   GELOKY_BASE=http://localhost:1000 GELOKY_TEST_KEY=... GELOKY_EMPTY_KEY=... GELOKY_LOW_KEY=... \
 *     node test/e2e.js
 *
 * GELOKY_TEST_KEY needs about $0.05, GELOKY_EMPTY_KEY a balance of 0 and GELOKY_LOW_KEY $0.002.
 * The node always calls https://geloky.com; the test copy of dist/ points it at GELOKY_BASE.
 * n8n runs with --network host, so GELOKY_BASE must be reachable from this machine.
 * N8N_IMAGE picks the n8n version (default n8nio/n8n:2.48.6). SHOW=1 prints n8n's raw output.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = (process.env.GELOKY_BASE || 'http://localhost:1000').replace(/\/+$/, '');
const KEYS = {
	good: process.env.GELOKY_TEST_KEY,
	empty: process.env.GELOKY_EMPTY_KEY,
	low: process.env.GELOKY_LOW_KEY,
	wrong: 'not-a-geloky-key',
};
const IMAGE = process.env.N8N_IMAGE || 'n8nio/n8n:2.48.6';
const ROOT = path.join(__dirname, '..');

for (const name of ['good', 'empty', 'low']) {
	if (!KEYS[name]) {
		console.error('Set GELOKY_TEST_KEY, GELOKY_EMPTY_KEY and GELOKY_LOW_KEY (see the top of this file).');
		process.exit(2);
	}
}
if (!fs.existsSync(path.join(ROOT, 'dist/nodes/Geloky/Geloky.node.js'))) {
	console.error('Run npm run build first.');
	process.exit(2);
}

// ─── An n8n user folder with the node in custom/, pointed at GELOKY_BASE ───────────────────

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-geloky-e2e-'));
const custom = path.join(home, 'custom', 'n8n-nodes-geloky');
fs.cpSync(path.join(ROOT, 'dist'), custom, { recursive: true });
for (const file of ['nodes/Geloky/GenericFunctions.js', 'credentials/GelokyApi.credentials.js']) {
	const p = path.join(custom, file);
	const text = fs.readFileSync(p, 'utf8');
	assert.ok(text.includes("'https://geloky.com'"), `no base URL to swap in ${file}`);
	fs.writeFileSync(p, text.split("'https://geloky.com'").join(`'${BASE}'`));
}

const credentials = Object.entries(KEYS).map(([name, apiKey]) => ({
	id: `gelokyE2e${name[0].toUpperCase()}${name.slice(1)}`.padEnd(16, 'x').slice(0, 16),
	name: `Geloky e2e ${name}`,
	type: 'gelokyApi',
	data: { apiKey },
}));
const credentialFor = (name) => {
	const c = credentials.find((x) => x.name === `Geloky e2e ${name}`);
	return { gelokyApi: { id: c.id, name: c.name } };
};

let workflowNumber = 0;
/** Manual trigger → a Code node that outputs the rows → the Geloky node. */
const workflow = (title, rows, geloky, key = 'good', settings = {}) => {
	workflowNumber += 1;
	return {
		id: `gelokyE2eWf${String(workflowNumber).padStart(5, '0')}`,
		name: `Geloky e2e: ${title}`,
		active: false,
		nodes: [
			{ id: 'a0000000-0000-4000-8000-000000000001', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{
				id: 'a0000000-0000-4000-8000-000000000002',
				name: 'Rows',
				type: 'n8n-nodes-base.code',
				typeVersion: 2,
				position: [220, 0],
				parameters: { jsCode: `return ${JSON.stringify(rows.map((json) => ({ json })))};` },
			},
			{
				id: 'a0000000-0000-4000-8000-000000000003',
				name: 'Geloky',
				type: 'CUSTOM.geloky',
				typeVersion: 1,
				position: [440, 0],
				parameters: geloky,
				credentials: credentialFor(key),
				...settings,
			},
		],
		connections: {
			Start: { main: [[{ node: 'Rows', type: 'main', index: 0 }]] },
			Rows: { main: [[{ node: 'Geloky', type: 'main', index: 0 }]] },
		},
		settings: { executionOrder: 'v1' },
	};
};

const CASES = [
	{
		wf: workflow(
			'geocode',
			[
				{ address: '350 5th Ave, New York, NY' },
				{ address: '   ' },
				{ address: 'qwxzv plmkq zzyt' },
				{ address: 'Eiffel Tower, Paris, France' },
			],
			{ operation: 'geocode', address: '={{ $json.address }}' },
		),
		cost: 0.003,
		check: (out) => {
			assert.equal(out.length, 4);
			assert.equal(out[0].found, true);
			assert.ok(Math.abs(out[0].latitude - 40.7484) < 0.01 && Math.abs(out[0].longitude + 73.9857) < 0.01);
			assert.match(out[0].matched_address, /350 5th/);
			assert.equal(out[0].coordinates, `${out[0].latitude},${out[0].longitude}`);
			assert.match(out[0].map_url, /\/geocoding\/lat-lon-point\/40\.\d+\/-73\.\d+$/);
			assert.equal(out[0].cost_usd, 0.001);
			assert.equal(out[1].found, false);
			assert.equal(out[1].cost_usd, 0);
			assert.match(out[1].message, /empty/);
			assert.equal(out[2].found, false);
			assert.equal(out[2].cost_usd, 0.001);
			assert.equal(out[2].latitude, null);
			assert.equal(out[3].found, true);
			assert.ok(Math.abs(out[3].latitude - 48.858) < 0.02, String(out[3].latitude));
		},
	},
	{
		wf: workflow(
			'reverse geocode',
			[
				{ lat: '40.748377', lon: '-73.984854' },
				{ lat: '140', lon: '10' },
				{ lat: '', lon: '' },
				{ lat: '48,85837', lon: '2,294481' },
			],
			{ operation: 'reverseGeocode', latitude: '={{ $json.lat }}', longitude: '={{ $json.lon }}' },
		),
		cost: 0.002,
		check: (out) => {
			assert.equal(out.length, 4);
			assert.equal(out[0].found, true);
			assert.match(out[0].address, /350 5th/);
			assert.ok(['address', 'place', 'street', 'area'].includes(out[0].type), out[0].type);
			assert.match(out[0].plus_code, /^[0-9A-Z]{8}\+[0-9A-Z]{2,}$/);
			assert.equal(out[0].cost_usd, 0.001);
			assert.equal(out[1].found, false);
			assert.equal(out[1].cost_usd, 0);
			assert.match(out[1].message, /not a point/);
			assert.equal(out[2].found, false);
			assert.equal(out[2].cost_usd, 0);
			assert.equal(out[3].found, true, 'decimal commas');
			assert.equal(out[3].latitude, 48.85837);
		},
	},
	{
		wf: workflow(
			'distance',
			[
				{ from: '40.748377,-73.984854', to: '40.7061, -74.0087' },
				{ from: '350 5th Ave, New York, NY', to: '1 Liberty Plaza, New York, NY' },
				{ from: '350 5th Ave, New York, NY', to: 'qwxzv plmkq zzyt' },
				{ from: '', to: 'Paris' },
			],
			{
				operation: 'calculateDistance',
				origin: '={{ $json.from }}',
				destination: '={{ $json.to }}',
				options: { units: 'km', vehicle: 'truck' },
			},
		),
		cost: 0.004,
		check: (out) => {
			assert.equal(out.length, 4);
			assert.equal(out[0].found, true);
			assert.equal(out[0].distance_units, 'km');
			assert.ok(out[0].distance > 3 && out[0].distance < 25, String(out[0].distance));
			assert.equal(out[0].straight_line, false);
			assert.ok(out[0].travel_time_minutes > 0);
			assert.equal(out[0].origin_address, null);
			assert.equal(out[0].cost_usd, 0.001);
			assert.equal(out[1].found, true);
			assert.match(out[1].origin_address, /350 5th/);
			assert.ok(out[1].destination_address.length > 0);
			assert.equal(out[1].cost_usd, 0.003);
			assert.equal(out[2].found, false);
			assert.match(out[2].message, /destination address was not found/);
			assert.equal(out[2].cost_usd, 0);
			assert.equal(out[3].found, false);
			assert.equal(out[3].cost_usd, 0);
		},
	},
	{
		wf: workflow('wrong key', [{ address: 'Paris' }], { operation: 'geocode', address: '={{ $json.address }}' }, 'wrong'),
		error: /does not accept this API key/,
	},
	{
		wf: workflow(
			'wrong key, continue on fail',
			[{ address: 'Paris' }, { address: 'Lyon' }],
			{ operation: 'geocode', address: '={{ $json.address }}' },
			'wrong',
			{ onError: 'continueRegularOutput' },
		),
		check: (out) => {
			assert.equal(out.length, 2);
			assert.match(out[0].error, /does not accept this API key/);
		},
	},
	{
		wf: workflow('empty wallet', [{ address: 'Paris' }], { operation: 'geocode', address: '={{ $json.address }}' }, 'empty'),
		error: /wallet is empty/,
	},
	{
		wf: workflow(
			'short wallet',
			[{ from: 'Paris, France', to: 'Lyon, France' }],
			{ operation: 'calculateDistance', origin: '={{ $json.from }}', destination: '={{ $json.to }}' },
			'low',
		),
		error: /costs \$0\.003/,
	},
];

// ─── Run ───────────────────────────────────────────────────────────────────────────────────

const balance = (key) => {
	const out = execFileSync('curl', [
		'-s', '-X', 'POST', `${BASE}/mcp`,
		'-H', 'Content-Type: application/json',
		'-H', 'Accept: application/json, text/event-stream',
		'-H', `Authorization: Bearer ${key}`,
		'-d', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account_balance', arguments: {} } }),
	]);
	return JSON.parse(out.toString()).result.structuredContent.balance_usd;
};

fs.writeFileSync(path.join(home, 'credentials.json'), JSON.stringify(credentials));
fs.mkdirSync(path.join(home, 'workflows'));
for (const c of CASES) {
	fs.writeFileSync(path.join(home, 'workflows', `${c.wf.id}.json`), JSON.stringify(c.wf));
}

const docker = (script) =>
	execFileSync(
		'docker',
		[
			'run', '--rm', '--network', 'host',
			'-u', `${os.userInfo().uid}:${os.userInfo().gid}`,
			'-v', `${home}:/home/node/.n8n`,
			'-e', 'N8N_DIAGNOSTICS_ENABLED=false',
			'-e', 'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false',
			'--entrypoint', 'sh', IMAGE, '-c', script,
		],
		{ stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
	).toString();

docker(
	'n8n import:credentials --input=/home/node/.n8n/credentials.json >/dev/null 2>&1 && ' +
		'n8n import:workflow --separate --input=/home/node/.n8n/workflows >/dev/null 2>&1 && echo imported',
);

let failed = 0;
for (const c of CASES) {
	const before = c.cost !== undefined ? balance(KEYS.good) : null;
	let raw;
	try {
		raw = docker(`n8n execute --id=${c.wf.id} --rawOutput 2>&1; true`);
	} catch (e) {
		raw = String(e.stdout || '') + String(e.stderr || '');
	}
	if (process.env.SHOW) {
		console.log(`--- ${c.wf.name}\n${raw}`);
	}
	try {
		if (c.error) {
			assert.match(raw, c.error);
		} else {
			const start = raw.indexOf('{');
			assert.ok(start >= 0, `no JSON in n8n's output:\n${raw.slice(0, 2000)}`);
			const run = JSON.parse(raw.slice(start));
			const out = run.data.resultData.runData.Geloky[0].data.main[0].map((item) => item.json);
			c.check(out);
		}
		if (before !== null) {
			const spent = Math.round((before - balance(KEYS.good)) * 1000) / 1000;
			assert.equal(spent, c.cost, `wallet: spent ${spent}, expected ${c.cost}`);
		}
		console.log(`ok   ${c.wf.name}`);
	} catch (e) {
		failed += 1;
		console.log(`FAIL ${c.wf.name}: ${e.message}`);
	}
}

fs.rmSync(home, { recursive: true, force: true });
console.log(`${CASES.length - failed} of ${CASES.length} passed`);
process.exit(failed ? 1 : 0);
