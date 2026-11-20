import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Geloky's public REST API (https://geloky.com/help-api). Every call is paid from the
 * user's API wallet: $0.001 per lookup, found or not, and a distance costs $0.001 more
 * for each end given as an address.
 */
export const BASE_URL = 'https://geloky.com';
export const PRICE_USD = 0.001;
export const DASHBOARD_URL = 'https://geloky.com/dashboard/tab/api';
const USER_AGENT = 'n8n-nodes-geloky';

export const round = (value: number, digits: number): number => {
	const f = Math.pow(10, digits);
	return Math.round(value * f) / f;
};

const blank = (value: unknown): boolean =>
	value === undefined || value === null || String(value).trim() === '';

/** Geloky's page for a point: the map, the point in other formats, its address on request. */
const mapUrl = (latitude: number, longitude: number): string =>
	`${BASE_URL}/geocoding/lat-lon-point/${round(latitude, 6)}/${round(longitude, 6)}`;

/** A coordinate in decimal degrees within ±limit, also with a decimal comma; null when it isn't one. */
const coordinate = (value: unknown, limit: number): number | null => {
	const text = String(value ?? '')
		.trim()
		.replace(',', '.');
	if (!/^-?\d+(\.\d+)?$/.test(text)) {
		return null;
	}
	const n = Number(text);
	return Math.abs(n) <= limit ? n : null;
};

/** "40.748377,-73.984854", as the distance call sends each end back. */
const pointOf = (text: unknown): { latitude: number | null; longitude: number | null } => {
	const [lat, lon] = String(text ?? '').split(',');
	const latitude = Number(lat);
	const longitude = Number(lon);
	return Number.isFinite(latitude) && Number.isFinite(longitude)
		? { latitude: round(latitude, 6), longitude: round(longitude, 6) }
		: { latitude: null, longitude: null };
};

const firstRow = (data: unknown): IDataObject | null =>
	Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null
		? (data[0] as IDataObject)
		: null;

type GelokyAnswer =
	| { data: unknown; notFound?: undefined }
	| { data?: undefined; notFound: string };

/**
 * GET from the REST API with the user's key. The API answers its errors with HTTP 200 and
 * {"code": "ERROR", "message": ...}: a wrong key or an empty wallet becomes an error, while
 * "not found" and "is empty" (nothing charged) come back as notFound, so one bad row doesn't
 * stop a whole list.
 */
async function gelokyRequest(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	itemIndex: number,
): Promise<GelokyAnswer> {
	let response: unknown;
	try {
		response = await this.helpers.httpRequestWithAuthentication.call(this, 'gelokyApi', {
			method: 'GET',
			url: `${BASE_URL}${path}`,
			qs,
			json: true,
			headers: { 'User-Agent': USER_AGENT },
		});
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}

	if (
		response === null ||
		typeof response !== 'object' ||
		Array.isArray(response) ||
		(response as IDataObject).code !== 'ERROR'
	) {
		return { data: response };
	}

	const message = String((response as IDataObject).message ?? '');
	if (/wrong key/i.test(message)) {
		throw new NodeApiError(this.getNode(), response as JsonObject, {
			itemIndex,
			httpCode: '401',
			message: 'Geloky does not accept this API key',
			description: `Pressing Change on the API tab of your Geloky dashboard replaces the key. Copy the current one from ${DASHBOARD_URL} into your Geloky credential.`,
		});
	}
	if (/enough funds|top up your api wallet/i.test(message)) {
		throw new NodeApiError(this.getNode(), response as JsonObject, {
			itemIndex,
			httpCode: '402',
			message: /enough funds/i.test(message)
				? 'Your Geloky API wallet is empty'
				: message.replace(/\s*Please top up your API Wallet\.?\s*$/i, ''),
			description: `Top up your API wallet at ${DASHBOARD_URL}, then run the workflow again.`,
		});
	}
	if (/not found|is empty/i.test(message)) {
		return { notFound: message };
	}
	throw new NodeApiError(this.getNode(), response as JsonObject, {
		itemIndex,
		message: message || 'Geloky could not answer this request',
	});
}

/** Address → latitude and longitude, with GET /api/geo/geocode. */
export async function geocodeAddress(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const address = String(this.getNodeParameter('address', i, '') ?? '').trim();
	const none = {
		found: false,
		address,
		latitude: null,
		longitude: null,
		coordinates: null,
		matched_address: null,
		map_url: null,
	};
	if (!address) {
		return {
			...none,
			cost_usd: 0,
			message: 'The address is empty, so nothing was looked up or charged.',
		};
	}

	const answer = await gelokyRequest.call(this, '/api/geo/geocode', { address }, i);
	const row = firstRow(answer.data);
	if (!row || blank(row.latitude)) {
		return {
			...none,
			cost_usd: PRICE_USD,
			message:
				answer.notFound ??
				'Geloky found no location for this address. Add the city and country, or check the spelling.',
		};
	}

	const latitude = round(Number(row.latitude), 6);
	const longitude = round(Number(row.longitude), 6);
	return {
		found: true,
		address,
		latitude,
		longitude,
		coordinates: `${latitude},${longitude}`,
		matched_address: String(row.address ?? ''),
		map_url: mapUrl(latitude, longitude),
		cost_usd: PRICE_USD,
	};
}

/**
 * Latitude and longitude → the nearest readable address, with GET /api/geo/reverse-geocode.
 * As in the API docs, type says how exact the address is (address, place, street or area) and
 * distance is metres from the point (null for an area).
 */
export async function reverseGeocode(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const rawLatitude = this.getNodeParameter('latitude', i, '');
	const rawLongitude = this.getNodeParameter('longitude', i, '');
	const none = {
		found: false,
		address: null,
		type: null,
		distance_m: null,
		address_latitude: null,
		address_longitude: null,
		plus_code: null,
		map_url: null,
	};
	if (blank(rawLatitude) || blank(rawLongitude)) {
		return {
			...none,
			latitude: rawLatitude,
			longitude: rawLongitude,
			cost_usd: 0,
			message: 'The latitude or the longitude is empty, so nothing was looked up or charged.',
		};
	}

	const latitude = coordinate(rawLatitude, 90);
	const longitude = coordinate(rawLongitude, 180);
	if (latitude === null || longitude === null) {
		return {
			...none,
			latitude: rawLatitude,
			longitude: rawLongitude,
			cost_usd: 0,
			message:
				'This is not a point: latitude is a number from -90 to 90 and longitude from -180 to 180, in decimal degrees, such as 40.74838 and -73.98485. Nothing was charged.',
		};
	}

	const answer = await gelokyRequest.call(
		this,
		'/api/geo/reverse-geocode',
		{ latlng: `${latitude},${longitude}` },
		i,
	);
	const row = firstRow(answer.data);
	if (!row || blank(row.address)) {
		return {
			...none,
			latitude,
			longitude,
			cost_usd: PRICE_USD,
			message: answer.notFound ?? 'Geloky found no address near this point.',
		};
	}

	const hasPoint = !blank(row.latitude);
	return {
		found: true,
		latitude,
		longitude,
		address: String(row.address),
		type: row.type ?? null,
		distance_m: blank(row.distance) ? null : Number(row.distance),
		address_latitude: hasPoint ? round(Number(row.latitude), 6) : latitude,
		address_longitude: hasPoint ? round(Number(row.longitude), 6) : longitude,
		plus_code: row.plus_code ?? null,
		map_url: mapUrl(latitude, longitude),
		cost_usd: PRICE_USD,
	};
}

/**
 * Road distance and travel time with GET /api/geo/distance, which takes either end as a point
 * or as an address and looks an address up first. An address it can't find is answered with
 * nothing charged. With no road between the ends the API measures a straight line and sends
 * time "-": then straight_line is true and there is no travel time.
 */
export async function calculateDistance(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const origin = String(this.getNodeParameter('origin', i, '') ?? '').trim();
	const destination = String(this.getNodeParameter('destination', i, '') ?? '').trim();
	const options = this.getNodeParameter('options', i, {}) as {
		route?: string;
		units?: string;
		vehicle?: string;
	};
	const units = options.units === 'km' ? 'km' : 'ml';
	const vehicle = ['auto', 'truck', 'walk'].includes(options.vehicle ?? '')
		? options.vehicle
		: 'auto';
	const priority = options.route === 'short' ? 'short' : 'fast';

	const none = {
		found: false,
		from: origin,
		to: destination,
		distance: null,
		distance_units: units === 'km' ? 'km' : 'mi',
		travel_time_minutes: null,
		straight_line: null,
		origin_latitude: null,
		origin_longitude: null,
		origin_address: null,
		destination_latitude: null,
		destination_longitude: null,
		destination_address: null,
		cost_usd: 0,
	};
	if (!origin || !destination) {
		return {
			...none,
			message: 'The From or the To value is empty, so nothing was measured or charged.',
		};
	}

	const answer = await gelokyRequest.call(
		this,
		'/api/geo/distance',
		{ origin, destination, units, vehicle, priority },
		i,
	);
	if (answer.notFound !== undefined) {
		return { ...none, message: answer.notFound };
	}

	const row = firstRow(answer.data);
	const length = row && !blank(row.length) ? Number(row.length) : NaN;
	if (!row || !Number.isFinite(length)) {
		return {
			...none,
			message: 'Geloky could not measure this distance. Check both ends and try again.',
		};
	}
	const time = row.time !== '-' && !blank(row.time) ? Number(row.time) : NaN;
	const straight = !Number.isFinite(time);
	const o = pointOf(row.origin);
	const d = pointOf(row.destination);
	// The API adds origin_address / destination_address only for ends given as addresses.
	const addresses = ['origin_address', 'destination_address'].filter((key) => key in row).length;

	return {
		found: true,
		from: origin,
		to: destination,
		distance: round(length, 3),
		distance_units: units === 'km' ? 'km' : 'mi',
		travel_time_minutes: straight ? null : round(time, 1),
		straight_line: straight,
		origin_latitude: o.latitude,
		origin_longitude: o.longitude,
		origin_address: row.origin_address ?? null,
		destination_latitude: d.latitude,
		destination_longitude: d.longitude,
		destination_address: row.destination_address ?? null,
		cost_usd: round((1 + addresses) * PRICE_USD, 3),
	};
}
