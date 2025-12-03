// Get environment variables with defaults
const appName = process.env.MIREN_APP || "bun";
const appVersion = process.env.MIREN_VERSION || "unknown";
const port = parseInt(process.env.PORT || "3000", 10);
const type = "bun"

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(getHtml(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve static files from images directory
    if (url.pathname.startsWith("/images/")) {
      const filePath = `.${url.pathname}`;
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

const getHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Miren</title>
    <link rel="icon" href="/images/favicon.png" type="image/png">

    <!-- Brand Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">

    <style>
        /* Reset and Base Styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            /* Miren Brand Colors */
            --blue-primary: #0059FF;
            --blue-mid: #4883FF;
            --blue-light: #80ABFF;
            --orange-primary: #F6834B;
            --orange-mid: #FD846C;
            --orange-dark: #E33F1F;

            /* Font Families */
            --font-primary: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            --font-mono: 'DM Mono', 'Courier New', monospace;
        }

        body {
            font-family: var(--font-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        }

        .container {
            text-align: center;
            padding: 3rem 2rem;
        }

        .card {
            background: white;
            border-radius: 1rem;
            padding: 4rem 3rem;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            position: relative;
        }

        /* Gradient border effect */
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(to right, var(--blue-primary), var(--blue-mid), var(--blue-light));
            border-radius: 1rem 1rem 0 0;
        }

        h1 {
            font-size: 3rem;
            font-weight: 900;
            line-height: 1.25;
            letter-spacing: -0.02em;
            margin-bottom: 1rem;
            background: linear-gradient(270deg, var(--blue-primary), var(--blue-mid), var(--blue-light), var(--blue-mid), var(--blue-primary));
            background-size: 200% 200%;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: gradient-shift 4s ease infinite;
        }

        .subtitle {
            font-family: var(--font-mono);
            font-size: 0.875rem;
            font-weight: 500;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #6b7280;
            margin-top: 1rem;
        }

        .logo {
            width: 200px;
            height: auto;
            margin: 0 auto 2rem;
            display: block;
        }

        .accent-line {
            width: 80px;
            height: 3px;
            background: linear-gradient(to right, var(--orange-dark), var(--orange-mid), var(--orange-primary));
            margin: 2rem auto;
            border-radius: 2px;
        }

        /* Gradient animation */
        @keyframes gradient-shift {
            0% {
                background-position: 0% 50%;
            }
            50% {
                background-position: 100% 50%;
            }
            100% {
                background-position: 0% 50%;
            }
        }

        /* Responsive */
        @media (max-width: 768px) {
            .logo {
                width: 150px;
            }

            h1 {
                font-size: 2rem;
            }

            .card {
                padding: 2.5rem 1.5rem;
            }

            .subtitle {
                font-size: 0.75rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <img src="/images/Miren-Logo-Secondary.svg" alt="Miren Logo" class="logo">
            <h1>Enjoy the Deploy</h1>
            <div class="accent-line"></div>
            <p class="subtitle">${appName} • version: ${appVersion} • deployed on ${type}</p>
        </div>
    </div>
</body>
</html>
`;

console.log(`Server running at http://localhost:${server.port}`);
