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

	documentationUrl = 'https://geloky.com/help-api#authentication';

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

	// account_balance is the free call of Geloky's MCP server, which also takes the key as ?key=.
	// It costs nothing and passes with an empty wallet; a wrong key answers with result.isError.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://geloky.com',
			url: '/mcp',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'account_balance', arguments: {} },
			},
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'result.isError',
					value: true,
					message:
						'Geloky does not accept this API key. Copy it again from the API tab of your dashboard; pressing Change there replaces it.',
				},
			},
		],
	};
}
