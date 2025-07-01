const net = require('net');
const os = require('os');
require('../common/logger');
const logger = new Logger('Test:IPC');

const ipcPath = os.platform() === 'win32' ? '\\\\.\\pipe\\synego_kernel_ipc' : '/tmp/synego_kernel.sock';

const client = net.createConnection(ipcPath, () => {
	logger.log(`Connected to IPC server at ${ipcPath}`);
	const message = {
		event: "/test",
		data: "Test IPC"
	};
	logger.log("Sending: ", message);
	client.write(JSON.stringify(message) + '\n');
});

client.on('data', (data) => {
	const reply = JSON.parse(data.toString().trim());
	logger.log(`Received:`, reply);
	client.end();
});

client.on('end', () => {
	logger.log('Connection closed');
});

client.on('error', (err) => {
	logger.error('Connection error:', err);
});
