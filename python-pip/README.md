# Simple HTTP Server

A basic HTTP server implementation using Flask.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the server:
```bash
python app.py
```

The server will start on http://localhost:3000

## Endpoints

- GET /: Returns "Hello, World!"
- GET /health: Returns server health status
