const net = require('net');
const os = require('os');
require('../common/logger');
const logger = new Logger('Test:IPC');

const ipcPath = os.platform() === 'win32' ? '\\\\.\\pipe\\synego_kernel_ipc' : '/tmp/synego_kernel.sock';

const client = net.createConnection(ipcPath, () => {
	logger.log(`Connected to IPC server at ${ipcPath}`);
	const message = 'Hello IPC Server!';
	logger.log(`Sending: "${message}"`);
	client.write(message + '\n');
});

client.on('data', (data) => {
	logger.log(`Received: "${data.toString().trim()}"`);
	client.end();
});

client.on('end', () => {
	logger.log('Connection closed');
});

client.on('error', (err) => {
	logger.error('Connection error:', err);
});
