# 🪣 Bucketorama

A tiny demo of **secretless S3 access** using Miren workload identity. It reads
and writes objects in a real S3 bucket without storing a single AWS access key.

When it runs in a Miren sandbox, it mints a short-lived OIDC token, exchanges it
for temporary AWS credentials, and talks to S3. Nothing static is stored;
nothing needs rotating. (See the [workload identity post](https://miren.dev/blog/workload-identity)
for the full story.)

## How it gets credentials

Bucketorama runs in two modes, picked automatically:

- **On Miren** (when `MIREN_IDENTITY_TOKEN_URL` and `AWS_ROLE_ARN` are both set):
  it mints a token scoped to AWS and hands it to the SDK's web-identity
  credential provider. The SDK trades it for temporary credentials and refreshes
  them on its own.
- **Locally** (anywhere else): it falls back to the default AWS credential chain
  (`~/.aws`, environment variables), so you can develop against a real bucket
  without a sandbox.

The whole integration is a handful of lines in `index.ts`:

```typescript
const s3 = new S3Client({
  region: REGION,
  credentials: onMiren
    ? async () =>
        fromWebToken({
          roleArn: ROLE_ARN,
          webIdentityToken: await tokenFor("sts.amazonaws.com"),
        })()
    : undefined,
});
```

### Why it mints a token instead of reading the file

Every Miren sandbox already has an identity token sitting at
`MIREN_IDENTITY_TOKEN_PATH` — you can `cat` it. So why does this app call the
mint endpoint instead of just reading that file and handing it to AWS?

Because the file token is *generic*: its audience is `miren`, meaning "I am this
workload," addressed to no one in particular. You could teach AWS to accept that
(register `miren` as the provider audience), and it would work. But then the
exact token AWS accepts is also valid against every other system that trusts the
`miren` audience, and it lives in a file refreshed hourly — so a leaked copy is
replayable across all of them.

Minting with `audience=sts.amazonaws.com` gives you a token that's *only* good at
AWS. If it leaks it can't be replayed against a peer service, because their
audience check won't match. You also get to pick a short TTL (this app asks for
900 seconds) instead of being stuck with the file's hour. Same reason GitHub
Actions makes you call `getIDToken(audience)` rather than reusing one generic
token everywhere.

## Run it locally

You need AWS credentials the default chain can resolve (a profile in `~/.aws`,
or `AWS_*` env vars) with read/write access to your bucket.

```bash
bun install
BUCKET=your-bucket AWS_REGION=us-east-1 bun run index.ts
# open http://localhost:8080
```

The page shows your identity (here, "local dev"), lists the bucket, and lets you
read and write objects.

## Deploy on Miren with AWS federation

This is the real demo: the app proves who it is to AWS with no stored key.

### 1. Deploy the app

```bash
miren deploy
```

Read the issuer URL and subject claim out of the running sandbox — you'll need
them for the AWS trust policy:

```bash
miren sandbox exec -i <sandbox-id> -- cat /var/run/miren/identity-token
```

Decode it (it's a JWT). The `iss` is your cluster's issuer URL; the `sub` looks
like `org:<org-id>:app:bucketorama:sandbox:<sandbox-id>`.

### 2. Register the cluster as an OIDC provider

In **IAM → Identity providers → Add provider → OpenID Connect**:

- Provider URL: your cluster's issuer (e.g. `https://cluster-abc123.miren.systems`)
- Audience: `sts.amazonaws.com`

AWS retrieves the TLS thumbprint automatically for a normal public cert.

### 3. Create a role AWS will let those tokens assume

**IAM → Roles → Create role → Custom trust policy.** Scope it to this app in
your org (the `sandbox:*` wildcard trusts any instance of the app):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/cluster-abc123.miren.systems" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "cluster-abc123.miren.systems:aud": "sts.amazonaws.com" },
      "StringLike": { "cluster-abc123.miren.systems:sub": "org:<org-id>:app:bucketorama:sandbox:*" }
    }
  }]
}
```

Attach a permissions policy giving the role access to your bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:ListBucket", "s3:GetObject", "s3:PutObject"],
    "Resource": ["arn:aws:s3:::<BUCKET>", "arn:aws:s3:::<BUCKET>/*"]
  }]
}
```

### 4. Point the app at your bucket and role

```bash
miren env set bucketorama BUCKET=<bucket>
miren env set bucketorama AWS_REGION=<region>
miren env set bucketorama AWS_ROLE_ARN=arn:aws:iam::<ACCOUNT_ID>:role/<role-name>
miren app restart bucketorama
```

Open the app and the identity panel now shows your real subject, mode
`workload identity`, and the bucket's contents — fetched with credentials that
were never stored anywhere.

### Heads up: this app has no auth

Bucketorama is a demo, not a hardened service. It has no authentication of its
own, so anyone who can reach it can read and write your bucket. Don't expose it
on a public route as-is.

If you want to reach the UI from a browser, put it behind
[Miren Route Protection](https://miren.dev/blog/route-protection) first — a
shared password gate takes a couple of commands. Otherwise keep it internal:
`miren sandbox exec` into the sandbox and `curl localhost:8080`.

## Configuration

| Variable        | Required | Purpose                                          |
| --------------- | -------- | ------------------------------------------------ |
| `BUCKET`        | yes      | S3 bucket to read and write                      |
| `AWS_REGION`    | no       | Bucket region (default `us-east-1`)              |
| `AWS_ROLE_ARN`  | on Miren | Role to assume via web identity                  |
| `PORT`          | no       | HTTP port (default `8080`)                       |

`MIREN_IDENTITY_TOKEN_URL`, `MIREN_IDENTITY_TOKEN_SECRET`, and
`MIREN_IDENTITY_TOKEN_PATH` are injected automatically in every Miren sandbox.
