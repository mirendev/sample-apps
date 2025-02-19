from flask import Flask, jsonify
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('server.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

app = Flask(__name__)

@app.route('/')
def hello_world():
    logger.info('Received request to /')
    return 'Hello, World from python+pip!'

@app.route('/health')
def health_check():
    logger.info('Received health check request')
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })

if __name__ == '__main__':
    logger.info('Starting server...')
    app.run(host='0.0.0.0', port=3000, debug=True)
