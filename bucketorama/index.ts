import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { fromWebToken } from "@aws-sdk/credential-providers";
import { decodeJwt } from "jose";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 8080);
const BUCKET = process.env.BUCKET;
const REGION = process.env.AWS_REGION ?? "us-east-1";
const ROLE_ARN = process.env.AWS_ROLE_ARN;

// --- Workload identity ---------------------------------------------------
// On Miren, every sandbox can mint a short-lived OIDC token scoped to whoever
// it's about to call. We mint one for AWS STS and hand it to the SDK; the SDK
// trades it for temporary credentials and refreshes them on its own. No access
// key is ever stored in this app.

const TOKEN_URL = process.env.MIREN_IDENTITY_TOKEN_URL;
const TOKEN_SECRET = process.env.MIREN_IDENTITY_TOKEN_SECRET;
const TOKEN_PATH = process.env.MIREN_IDENTITY_TOKEN_PATH;

const cache = new Map<string, { token: string; exp: number }>();

// Mint (and cache) a token for a given audience against the sandbox's local
// mint endpoint. This is the same helper from the workload identity blog post.
async function tokenFor(audience: string, ttlSeconds = 900): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(audience);
  if (hit && hit.exp - 60 > now) return hit.token;

  const url = new URL(TOKEN_URL!);
  url.searchParams.set("audience", audience);
  url.searchParams.set("ttl", String(ttlSeconds));

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${TOKEN_SECRET}` },
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status}`);

  const { value } = (await res.json()) as { value: string };
  cache.set(audience, { token: value, exp: decodeJwt(value).exp! });
  return value;
}

// We're on Miren if the mint endpoint and a role to assume are both present.
// Otherwise fall back to the default AWS credential chain (~/.aws, env vars)
// so you can run this against a real bucket locally, no sandbox required.
const onMiren = Boolean(TOKEN_URL && TOKEN_SECRET && ROLE_ARN);

const s3 = new S3Client({
  region: REGION,
  credentials: onMiren
    ? async () =>
        fromWebToken({
          roleArn: ROLE_ARN!,
          webIdentityToken: await tokenFor("sts.amazonaws.com"),
        })()
    : undefined,
});

// --- Who am I? -----------------------------------------------------------
// Read our own identity straight off the file Miren drops in every sandbox.
function whoAmI(): string {
  if (!TOKEN_PATH) return "local dev (default AWS credentials)";
  try {
    const token = readFileSync(TOKEN_PATH, "utf8").trim();
    const claims = decodeJwt(token);
    return `${claims.sub} (org ${claims.organization_id}, cluster ${claims.cluster_id})`;
  } catch (err) {
    return `could not read identity: ${(err as Error).message}`;
  }
}

// --- S3 operations -------------------------------------------------------
async function listObjects(): Promise<string> {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const items = out.Contents ?? [];
  if (items.length === 0) return "(empty)";
  return items
    .map((o) => `${(o.Key ?? "").padEnd(40)} ${String(o.Size ?? 0).padStart(10)} bytes`)
    .join("\n");
}

async function readObject(key: string): Promise<string> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await out.Body?.transformToString()) ?? "";
}

async function writeObject(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

// --- Web UI --------------------------------------------------------------
function page(list: string, message = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Bucketorama</title>
  <style>
    body { font-family: monospace; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    .section { background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px; }
    pre { background: #222; color: #0f0; padding: 10px; overflow-x: auto; white-space: pre-wrap; }
    input, textarea { font-family: monospace; width: 100%; padding: 8px; margin: 5px 0; }
    button { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; }
    button:hover { background: #0056b3; }
    .error { color: #c00; }
    .success { color: #080; }
  </style>
</head>
<body>
  <h1>🪣 Bucketorama</h1>
  <div class="section">
    <h2>Identity</h2>
    <pre>${whoAmI()}</pre>
    <small>bucket: <b>${BUCKET ?? "(unset)"}</b> · region: <b>${REGION}</b> · mode: <b>${onMiren ? "workload identity" : "local"}</b></small>
  </div>
  <div class="section">
    <h2>Objects in ${BUCKET ?? "(unset)"}</h2>
    <pre>${list}</pre>
  </div>
  <div class="section">
    <h2>Write object</h2>
    <form method="POST" action="/write">
      <input type="text" name="key" placeholder="hello.txt" required>
      <textarea name="content" rows="4" placeholder="content..."></textarea>
      <button type="submit">Write</button>
    </form>
  </div>
  <div class="section">
    <h2>Read object</h2>
    <form method="GET" action="/read">
      <input type="text" name="key" placeholder="hello.txt" required>
      <button type="submit">Read</button>
    </form>
  </div>
  ${message}
</body>
</html>`;
}

async function renderIndex(message = ""): Promise<Response> {
  let list: string;
  try {
    list = await listObjects();
  } catch (err) {
    list = `error: ${(err as Error).message}`;
  }
  return new Response(page(list, message), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/read") {
      const key = url.searchParams.get("key");
      if (!key) return renderIndex();
      try {
        const content = await readObject(key);
        return renderIndex(
          `<div class="section success"><h3>${key}</h3><pre>${content}</pre></div>`,
        );
      } catch (err) {
        return renderIndex(
          `<div class="section error">read ${key} failed: ${(err as Error).message}</div>`,
        );
      }
    }

    if (url.pathname === "/write" && req.method === "POST") {
      const form = await req.formData();
      const key = String(form.get("key") ?? "");
      const content = String(form.get("content") ?? "");
      if (!key) return renderIndex(`<div class="section error">no key given</div>`);
      try {
        await writeObject(key, content);
        return renderIndex(
          `<div class="section success">wrote ${content.length} bytes to ${key}</div>`,
        );
      } catch (err) {
        return renderIndex(
          `<div class="section error">write ${key} failed: ${(err as Error).message}</div>`,
        );
      }
    }

    return renderIndex();
  },
});

console.log(`bucketorama listening on :${PORT} (bucket=${BUCKET}, mode=${onMiren ? "workload-identity" : "local"})`);
