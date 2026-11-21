import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GelokyApi implements ICredentialType {
	name = 'gelokyApi';

	displayName = 'Geloky API';

	icon: Icon = { light: 'file:../icons/geloky.light.svg', dark: 'file:../icons/geloky.dark.svg' };

	documentationUrl = 'https://geloky.com/blog/geocode-addresses-in-n8n#install-the-geloky-node';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The key on the API tab of your Geloky dashboard (https://geloky.com/dashboard/tab/api). Lookups are paid from the API wallet on the same tab.',
		},
	];

	// The REST API takes the key in the "key" query parameter.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			qs: {
				key: '={{$credentials.apiKey}}',
			},
		},
	};

	// GET /api/geo/balance is free and answers an empty wallet too, so a new account can connect
	// before its first top-up. The key goes in the "key" query parameter, as authenticate adds it;
	// a wrong key answers HTTP 200 with code ERROR.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://geloky.com',
			url: '/api/geo/balance',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'code',
					value: 'ERROR',
					message:
						'Geloky does not accept this API key. Copy it again from the API tab of your dashboard; pressing Change there replaces it.',
				},
			},
		],
	};
}
