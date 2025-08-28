# Conference App

A simple conference management application built with Express.js and SQLite.

## Features

- **Organizer Dashboard**: Create, edit, and delete conference talks
- **Attendee Registration**: Sign up and select talks to attend
- **Persistent Storage**: SQLite database stored in `/miren/data/local`
- **Auto-migration**: Database schema automatically created on first run

## Installation

```bash
npm install
```

## Running the App

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Usage

1. Navigate to the home page
2. Choose "Organizer Dashboard" to manage talks
3. Choose "Attendee Registration" to sign up and select talks

## Database

The SQLite database is stored at `/miren/data/local/conference.db` and includes:
- `talks` - Conference sessions
- `attendees` - Registered users  
- `registrations` - Talk attendance records

The database is automatically initialized with sample data on first run.