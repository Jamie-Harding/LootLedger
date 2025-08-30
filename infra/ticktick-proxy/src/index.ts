// Cloudflare Worker: TickTick token proxy (TypeScript)
export interface Env {
	TICKTICK_CLIENT_ID: string;
	TICKTICK_CLIENT_SECRET: string;
}

const TICKTICK_TOKEN = 'https://ticktick.com/oauth/token';

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		if (req.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		// accept either "/" or "/oauth/token" for convenience
		const url = new URL(req.url);
		if (url.pathname !== '/' && url.pathname !== '/oauth/token') {
			return new Response('Not Found', { status: 404 });
		}

		if (!env.TICKTICK_CLIENT_ID || !env.TICKTICK_CLIENT_SECRET) {
			return new Response('Server not configured', { status: 500 });
		}

		// read original body (x-www-form-urlencoded)
		const raw = await req.text();
		const params = new URLSearchParams(raw);

		// ✅ Force the body to use the SAME client_id as our Basic Auth
		params.set('client_id', env.TICKTICK_CLIENT_ID);

		// ✅ Ensure scope is present (TickTick examples include it)
		if (!params.get('scope')) {
			params.set('scope', 'tasks:read tasks:write');
		}

		// NOTE: code_verifier (for PKCE) is fine to forward if present.
		// TickTick may ignore it, but it won't hurt.

		const basic = btoa(`${env.TICKTICK_CLIENT_ID}:${env.TICKTICK_CLIENT_SECRET}`);

		const upstream = await fetch(TICKTICK_TOKEN, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${basic}`,
			},
			body: params.toString(),
		});

		const text = await upstream.text();
		return new Response(text, {
			status: upstream.status,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-store',
			},
		});
	},
};
