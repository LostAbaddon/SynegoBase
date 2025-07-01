const dgram = require('dgram');
require('../common/logger');
const logger = new Logger('Test:UDP');

const client = dgram.createSocket('udp4');
const port = 3003;
const host = '127.0.0.1';
const message = Buffer.from(JSON.stringify({
	event: "/test",
	data: "Test UDP"
}));

client.on('message', (msg, rinfo) => {
	const reply = JSON.parse(msg.toString());
	logger.log("Received:", reply, `from ${rinfo.address}:${rinfo.port}`);
	client.close();
});

client.on('close', () => {
	logger.log('Connection closed');
});

client.on('error', (err) => {
	logger.error('UDP client error:', err);
	client.close();
});

logger.log(`Sending: "${message}" to ${host}:${port}`);
client.send(message, port, host, (err) => {
	if (err) {
		logger.error('Error sending message:', err);
		client.close();
	}
});
