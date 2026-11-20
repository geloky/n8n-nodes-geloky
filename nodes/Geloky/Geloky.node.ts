import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { calculateDistance, geocodeAddress, reverseGeocode } from './GenericFunctions';

/**
 * Programmatic rather than declarative: an empty or invalid input must not reach the API (every
 * call is charged), and the API's HTTP 200 error answers must become either a "not found" item
 * (nothing charged, the list goes on) or a real error (wrong key, empty wallet).
 *
 * Items go one at a time. Parallel calls with one key were undercharged by the API
 * (19 Nov 2026: five at once were billed as one), so don't add concurrency until that is fixed.
 */
const OPERATIONS: Record<string, (this: IExecuteFunctions, i: number) => Promise<IDataObject>> = {
	calculateDistance,
	geocode: geocodeAddress,
	reverseGeocode,
};

export class Geloky implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Geloky',
		name: 'geloky',
		icon: { light: 'file:../../icons/geloky.light.svg', dark: 'file:../../icons/geloky.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ {"calculateDistance": "Calculate distance", "geocode": "Geocode address", "reverseGeocode": "Reverse geocode"}[$parameter["operation"]] }}',
		description:
			'Geocode addresses, reverse geocode coordinates and measure road distance and travel time with Geloky',
		defaults: {
			name: 'Geloky',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'gelokyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Calculate Distance',
						value: 'calculateDistance',
						description: 'Get the road distance and travel time between two addresses or points',
						action: 'Calculate the distance between two places',
					},
					{
						name: 'Geocode Address',
						value: 'geocode',
						description: 'Get the latitude and longitude of an address, a place or a postal code',
						action: 'Geocode an address',
					},
					{
						name: 'Reverse Geocode',
						value: 'reverseGeocode',
						description: 'Get the nearest street address to a latitude and longitude',
						action: 'Reverse geocode coordinates',
					},
				],
				default: 'geocode',
			},

			// Geocode Address
			{
				displayName: 'Address',
				name: 'address',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 350 5th Ave, New York, NY 10118',
				description:
					'A full address works best: street, city, postal code and country. A place name or a postal code works too. Each lookup costs $0.001 from your Geloky API wallet, found or not.',
				displayOptions: {
					show: {
						operation: ['geocode'],
					},
				},
			},

			// Reverse Geocode
			{
				displayName: 'Latitude',
				name: 'latitude',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 40.74838',
				description: 'In decimal degrees, from -90 to 90',
				displayOptions: {
					show: {
						operation: ['reverseGeocode'],
					},
				},
			},
			{
				displayName: 'Longitude',
				name: 'longitude',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. -73.98485',
				description:
					'In decimal degrees, from -180 to 180. Each lookup costs $0.001 from your Geloky API wallet, found or not.',
				displayOptions: {
					show: {
						operation: ['reverseGeocode'],
					},
				},
			},

			// Calculate Distance
			{
				displayName: 'From',
				name: 'origin',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 350 5th Ave, New York, NY or 40.74838,-73.98485',
				description:
					'An address, or a latitude and longitude separated by a comma. Geloky looks an address up first, for $0.001 more; if it cannot find it, nothing is charged.',
				displayOptions: {
					show: {
						operation: ['calculateDistance'],
					},
				},
			},
			{
				displayName: 'To',
				name: 'destination',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 1 Liberty Plaza, New York, NY or 40.70950,-74.01060',
				description: 'An address, or a latitude and longitude separated by a comma',
				displayOptions: {
					show: {
						operation: ['calculateDistance'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				description:
					'The distance costs $0.001 from your Geloky API wallet. With no road between the two ends, it is a straight line and there is no travel time.',
				displayOptions: {
					show: {
						operation: ['calculateDistance'],
					},
				},
				options: [
					{
						displayName: 'Route',
						name: 'route',
						type: 'options',
						options: [
							{ name: 'Fastest', value: 'fast' },
							{ name: 'Shortest', value: 'short' },
						],
						default: 'fast',
						description: 'Whether to take the quickest route or the shortest one',
					},
					{
						displayName: 'Travel By',
						name: 'vehicle',
						type: 'options',
						options: [
							{ name: 'Car', value: 'auto' },
							{ name: 'Truck', value: 'truck' },
							{ name: 'Walking', value: 'walk' },
						],
						default: 'auto',
					},
					{
						displayName: 'Units',
						name: 'units',
						type: 'options',
						options: [
							{ name: 'Kilometers', value: 'km' },
							{ name: 'Miles', value: 'ml' },
						],
						default: 'ml',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// One item after another: about four items a second.
		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const run = OPERATIONS[operation];
				if (!run) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported`,
						{ itemIndex: i },
					);
				}
				returnData.push({ json: await run.call(this, i), pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					// re-wrapping hands back the error gelokyRequest built, with its message and item
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
