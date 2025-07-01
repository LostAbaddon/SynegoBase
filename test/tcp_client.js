const net = require('net');
require('../common/logger');
const logger = new Logger('Test:TCP');

const client = new net.Socket();
const port = 3002;
const host = '127.0.0.1';

client.connect(port, host, () => {
	logger.log(`Connected to TCP server at ${host}:${port}`);
	const message = {
		event: "/test",
		data: "Test TCP"
	};
	logger.log("Sending: ", message);
	client.write(JSON.stringify(message) + '\n');
});

client.on('data', (data) => {
	const reply = JSON.parse(data.toString().trim());
	logger.log(`Received:`, reply);
	client.destroy(); // kill client after server's response
});

client.on('close', () => {
	logger.log('Connection closed');
});

client.on('error', (err) => {
	logger.error('Connection error:', err);
});

