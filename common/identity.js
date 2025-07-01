const os = require('os');

const getIPAddress = () => {
	const interfaces = os.networkInterfaces();
	let ipv4 = null;
	let ipv6 = null;

	for (const name of Object.keys(interfaces)) {
		for (const iface of interfaces[name]) {
			if (iface.internal) {
				continue;
			}
			if (iface.family === 'IPv4' && !ipv4) {
				ipv4 = iface.address;
			}
			else if (iface.family === 'IPv6' && !ipv6) {
				ipv6 = iface.address;
			}
		}
	}
	return ipv4 || ipv6 || '127.0.0.1';
};

const generateNodeId = () => {
	const ip = getIPAddress();
	const pid = process.pid;
	return `${pid}@${ip}`;
};

module.exports = {
	generateNodeId,
	getIPAddress,
};