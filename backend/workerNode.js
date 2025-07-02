const os = require('os');
const cluster = require('cluster');
const net = require('net');
const fs = require('fs').promises;
const path = require('path');

require('../common/common');
require('../common/fsp');
require('../common/logger');
const logger = new Logger('Worker' + (cluster.isWorker ? '-' + process.pid : ''));
const { generateNodeId, getIPAddress } = require('../common/identity');
const EgoNodeId = generateNodeId();

const EventCenter = require('./eventCenter');

let rootPath = process.cwd();
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

// Message Center
const Pendings = {};

// --- 准备与后台的连接 ---
const onChannelMessage = (message) => {
	const data = isObject(message) ? message : convertParma(message.toString());
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
const prepareWorker = () => {
	process.on('message', onChannelMessage);

	kernelConnection = {};
	kernelConnection.send = (event, data) => {
		const msg = { event, data };
		process.send(msg);
	};
	kernelConnection.sendAndWait = (event, data) => new Promise(res => {
		const rid = newID(16);
		Pendings[rid] = res;
		const msg = { event, rid, data };
		process.send(msg);
	});
};

/**
 * 启动服务响应节点
 * @param {string} [configPath] - 配置文件的可选路径。
 */
const start = async (configPath) => {
	if (configPath.match(/^\./)) configPath = path.join(rootPath, configPath);
	logger.log(`Service node starting with ID: ${EgoNodeId}`);

	const config = await loadConfig(configPath, DefaultConfig);
	if (!config || !config.master || !config.master.host) {
		logger.error('Invalid Config File');
		return;
	}

	if (cluster.isWorker) {
		kernelRelation = 2;
	}
	else {
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
	}

	if (kernelRelation === 0) {
		await prepareWS(config.master.host, config.master.ws);
	}
	else if (kernelRelation === 1) {
		await prepareIPC(config.master.ipc);
	}
	else if (kernelRelation === 2) {
		prepareWorker();
	}
	else {
		return;
	}

	/* 加载响应实体 */
	let serviceList = [];
	if (!!config.handlers) {
		await EventCenter.amount(config.handlers);
		serviceList = EventCenter.getServiceList();
	}

	const reShakeHand = await kernelConnection.sendAndWait('/synego/shakehand', {
		nid: EgoNodeId,
		data: {serviceList},
	});
	logger.log('|====---::>', reShakeHand);
};

module.exports = {
	start,
};

// For Worker SubProcess
if (cluster.isWorker) {
	rootPath = process.env.rootPath;
	logger.log(process.cwd(), rootPath);
	start(process.env.config);
}