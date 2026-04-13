// QavatarProxy.js

const QQ_EMAIL_REGEX = /^([1-9][0-9]{4,11})@qq\.com$/i;

async function sha256(message) {
	const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
	const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function proxyFetch(url) {
	const upstream = await fetch(
		new Request(url, {
			method: "GET",
			headers: { "User-Agent": "Mozilla/5.0 (compatible; QavatarProxy/1.0)" },
		}),
	);

	const responseHeaders = new Headers();
	for (const [k, v] of upstream.headers.entries()) {
		if (!["set-cookie", "cf-ray", "server"].includes(k.toLowerCase())) {
			responseHeaders.set(k, v);
		}
	}
	responseHeaders.set("Cache-Control", "public, max-age=3600");
	responseHeaders.set("X-Proxied-By", "QavatarProxy");

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	});
}

// ── 路由：GET /avatar/:hash ──────────────────────────────────────────────────
async function handleGetAvatar(hash, request, env) {
	if (!/^[0-9a-f]{64}$/i.test(hash)) {
		return new Response("Invalid hash", { status: 400 });
	}

	const normalizedHash = hash.toLowerCase();

	// 第一步：请求 Gravatar，强制 d=404 以探测该邮箱是否注册了 Gravatar
	// 此处不附带 GRAVATAR_EXTRA_PARAMS，仅用于探测
	const probeParams = new URLSearchParams(new URL(request.url).searchParams);
	probeParams.set("d", "404");
	const gravatarProbeUrl = `https://secure.gravatar.com/avatar/${normalizedHash}?${probeParams}`;

	const probeRes = await fetch(
		new Request(gravatarProbeUrl, {
			method: "GET",
			headers: { "User-Agent": "Mozilla/5.0 (compatible; QavatarProxy/1.0)" },
		}),
	);

	if (probeRes.status !== 404) {
		// 非 404：该邮箱已注册 Gravatar，直接将探测响应转发给客户端
		const responseHeaders = new Headers();
		for (const [k, v] of probeRes.headers.entries()) {
			if (!["set-cookie", "cf-ray", "server"].includes(k.toLowerCase())) {
				responseHeaders.set(k, v);
			}
		}
		responseHeaders.set("Cache-Control", "public, max-age=3600");
		responseHeaders.set("X-Proxied-By", "QavatarProxy");
		return new Response(probeRes.body, {
			status: probeRes.status,
			headers: responseHeaders,
		});
	}

	// 第二步：Gravatar 返回 404，查询 KV 中是否有已知 QQ 哈希映射
	const qqNum = await env.QAVATAR.get(normalizedHash);
	if (qqNum) {
		return proxyFetch(`https://q1.qlogo.cn/g?b=qq&nk=${qqNum}&s=100`);
	}

	if (env.DEFAULT_AVATAR_URL) {
		// 第三步：KV 也未命中，检查是否配置了自定义默认头像
		return Response.redirect(env.DEFAULT_AVATAR_URL, 302);
	}
	// 未配置则回退到 Gravatar 并附带 GRAVATAR_EXTRA_PARAMS
	const fallbackParams = new URLSearchParams(new URL(request.url).searchParams);
	const extraParams = new URLSearchParams(env.GRAVATAR_EXTRA_PARAMS || "");
	for (const [k, v] of extraParams.entries()) {
		fallbackParams.set(k, v);
	}
	const qs = fallbackParams.toString();
	return proxyFetch(
		`https://secure.gravatar.com/avatar/${normalizedHash}${qs ? "?" + qs : ""}`,
	);
}

// ── 路由：POST /avatar/admin/add ─────────────────────────────────────────────
async function handleAdminAdd(request, env) {
	const authHeader = request.headers.get("Authorization") || "";
	let body;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid JSON body" },
			{ status: 400 },
		);
	}

	const providedSecret = authHeader.startsWith("Bearer ")
		? authHeader.slice(7).trim()
		: body.key || "";

	if (!env.ADMIN_SECRET || providedSecret !== env.ADMIN_SECRET) {
		return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
	}

	const email = (body.email || "").trim().toLowerCase();
	if (!email) {
		return Response.json(
			{ ok: false, error: "Missing email" },
			{ status: 400 },
		);
	}

	const hash = await sha256(email);
	const qqMatch = email.match(QQ_EMAIL_REGEX);

	if (qqMatch) {
		await env.QAVATAR.put(hash, qqMatch[1]);
		return Response.json({ ok: true, email, hash, type: "qq", qq: qqMatch[1] });
	} else {
		return Response.json(
			{ ok: false, error: "Not a QQ email" },
			{ status: 400 },
		);
	}
}

// ── 主入口 ───────────────────────────────────────────────────────────────────
export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);
		const method = request.method;

		if (method === "GET") {
			const m = pathname.match(/^\/avatar\/([^/]+)$/);
			if (m) return handleGetAvatar(m[1], request, env);
		}

		if (method === "POST" && pathname === "/avatar/admin/add") {
			return handleAdminAdd(request, env);
		}

		return new Response("Not Found", { status: 404 });
	},
};
