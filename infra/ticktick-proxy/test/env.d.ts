declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		TICKTICK_CLIENT_ID: string;
		TICKTICK_CLIENT_SECRET: string;
	}
}
