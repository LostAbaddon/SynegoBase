const os = require('os');
const net = require('net');
const fs = require('fs').promises;
const path = require('path');

require('../common/common');
require('../common/logger');
const logger = new Logger('Worker');
const { generateNodeId, getIPAddress } = require('../common/identity');
const EgoNodeId = generateNodeId();

let kernelRelation = 0; // 0: Other node; 1: Same node other process; 2: Same node same process.
let kernelConnection = null;

// --- 默认配置 ---
const DefaultConfig = {
	master: {
		host: "127.0.0.1",
		ws: 3000,
		ipc: os.platform() === 'win32' ? '\\\\.\\pipe\\synego_communicate_ipc' : '/tmp/synego_communicate.sock'
	}
};
// --- 配置加载 ---
const loadConfig = async (configPath) => {
	if (!configPath) {
		logger.warn('No config file path provided. Using default configuration.');
		return DefaultConfig;
	}
	try {
		if (await fileExists(configPath)) {
			logger.log(`Loading configuration from: ${configPath}`);
			const configData = await fs.readFile(configPath, 'utf8');
			try {
				return deepMerge(JSON.parse(configData), DefaultConfig);
			}
			catch (err) {
				logger.error(`Load Configuration Failed: ${err.message}`);
				return DefaultConfig;
			}
		}
		else {
			logger.warn(`Config file not found at ${configPath}. Using default configuration.`);
			return DefaultConfig;
		}
	}
	catch (error) {
		logger.error(`Error reading or parsing config file: ${error.message}`);
		return DefaultConfig;
	}
};

// Message Center
const Pendings = {};

// --- 准备与后台的连接 ---
const onChannelMessage = (message) => {
	const data = convertParma(message.toString());
	const rid = data.rid;
	if (!!rid) {
		delete data.rid;
		const res = Pendings[rid];
		delete Pendings[rid];
		if (!!res) res(data);
	}
	else {
		// call event handler...
		logger.log(`Received:`, data);
	}
};
const onChannelClosed = () => {
	logger.log('Connetion with kernel closed.');
	kernelConnection.send = () => {};
	kernelConnection.sendAndWait = () => {};
};
const onChannelError = (error) => {
	logger.error('Connection error:', error);
};
const prepareIPC = (ipcPath) => new Promise(res => {
	const net = require('net');

	kernelConnection = net.createConnection(ipcPath, () => {
		logger.log(`Connected to IPC server at ${ipcPath}`);

		kernelConnection.send = (event, data) => {
			const msg = { event, data };
			kernelConnection.write(JSON.stringify(msg) + '\n');
		};
		kernelConnection.sendAndWait = (event, data) => new Promise(res => {
			const rid = newID(16);
			Pendings[rid] = res;
			const msg = { event, rid, data };
			kernelConnection.write(JSON.stringify(msg) + '\n');
		});

		res();
	});
	kernelConnection.on('data', onChannelMessage);
	kernelConnection.on('end', onChannelClosed);
	kernelConnection.on('error', onChannelError);
});
const prepareWS = (host, port) => new Promise(res => {
	const WebSocket = require('ws');
	const address = `ws://${host}:${port}`;

	kernelConnection = new WebSocket(address);
	kernelConnection._send = kernelConnection.send;
	kernelConnection.on('open', () => {
		logger.log(`Connected to WS server at ${address}`);

		kernelConnection.send = (event, data) => {
			const msg = { event, data };
			kernelConnection._send(JSON.stringify(msg));
		};
		kernelConnection.sendAndWait = (event, data) => new Promise(res => {
			const rid = newID(16);
			Pendings[rid] = res;
			const msg = { event, rid, data };
			kernelConnection._send(JSON.stringify(msg));
		});

		res();
	});
	kernelConnection.on('message', onChannelMessage);
	kernelConnection.on('close', onChannelClosed);
	kernelConnection.on('error', onChannelError);
});

/**
 * 启动服务响应节点
 * @param {string} [configPath] - 配置文件的可选路径。
 */
const start = async (configPath) => {
	logger.log(`Service node starting with ID: ${EgoNodeId}`);

	const config = await loadConfig(configPath);
	if (!config || !config.master || !config.master.host) {
		logger.error('Invalid Config File');
		return;
	}

	let myIP = getIPAddress();
	if ([myIP, 'localhost', '127.0.0.1', '::1', '0.0.0.0', "::"].includes(config.master.host)) {
		kernelRelation = 1;
	}
	if (kernelRelation === 1 && !config.master.ipc) {
		kernelRelation = 0;
	}
	if (kernelRelation === 0 && !config.master.ws) {
		logger.error('Invalid Kernel Connection Configuration');
		return;
	}

	/* 其他初始化处理 */
	let data = {};

	if (kernelRelation === 1) {
		await prepareIPC(config.master.ipc);
	}
	else if (kernelRelation === 0) {
		await prepareWS(config.master.host, config.master.ws);
	}
	const reShakeHand = await kernelConnection.sendAndWait('/synego/shakehand', {
		nid: EgoNodeId,
		data
	});
	console.log('|====---::>', reShakeHand);
};

module.exports = {
	start,
};
