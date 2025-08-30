// src/index.js — Cloudflare Worker: TickTick token proxy
export default {
	async fetch(req, env) {
		if (req.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const TOKEN_URL = 'https://ticktick.com/oauth/token'; // official
		const id = env.TICKTICK_CLIENT_ID;
		const secret = env.TICKTICK_CLIENT_SECRET;
		if (!id || !secret) return new Response('Server not configured', { status: 500 });

		const basic = btoa(`${id}:${secret}`);
		const body = await req.text(); // x-www-form-urlencoded from app

		const r = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${basic}`,
			},
			body,
		});

		const text = await r.text();
		return new Response(text, {
			status: r.status,
			headers: {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*', // desktop-friendly CORS
			},
		});
	},
};
