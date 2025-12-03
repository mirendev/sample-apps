# Miren Demo App

A simple Bun application that displays "Welcome to Miren" with styling that matches the Miren Cloud brand.

## Features

- **Bun-powered**: Fast and modern JavaScript runtime
- **Stock CSS**: No frameworks, just clean custom CSS
- **Miren Brand Styling**: Matches the design from `../cloud`
  - Official Miren logo
  - Hanken Grotesk and DM Mono fonts
  - Brand colors (blues and orange accents)
  - Animated gradient text
  - Clean, modern aesthetic
  - Fully responsive design

## Setup

```bash
# Install dependencies
bun install
```

## Running the App

```bash
# Start the server (default values)
bun run dev

# Or with custom environment variables
MIREN_APP="my-app" MIREN_VERSION="1.0.0" bun run dev

# Use a different port
PORT=8080 bun run dev

# Combine multiple variables
PORT=8080 MIREN_APP="my-app" MIREN_VERSION="1.0.0" bun run dev
```

## Development

```bash
# Type check
bun run typecheck
```

The app will be available at [http://localhost:3000](http://localhost:3000)

### Environment Variables

- `PORT` - Port number to listen on (default: 3000)
- `MIREN_APP` - Application name (default: "bun")
- `MIREN_VERSION` - Application version (default: "unknown")

The `MIREN_APP` and `MIREN_VERSION` values are displayed on the page as "{app} • {version}"

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Styling**: Custom CSS with Miren brand guidelines
- **Fonts**: Google Fonts (Hanken Grotesk, DM Mono)

## Project Structure

```
demo/
├── index.ts          # Main server file
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── images/           # Static assets (Miren logo)
└── README.md         # This file
```
