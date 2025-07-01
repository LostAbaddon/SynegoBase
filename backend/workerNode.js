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
		ipc: os.platform() === 'win32' ? '\\\\.\\pipe\\synego_register_ipc' : '/tmp/synego_register.sock'
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

// --- 发送接入请求 ---
const prepareIPC = async (ipcPath) => {
	const net = require('net');

	kernelConnection = net.createConnection(ipcPath, () => {
		logger.log(`Connected to IPC server at ${ipcPath}`);
	});
	kernelConnection.on('data', (data) => {
		data = convertParma(data.toString());
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
	});
	kernelConnection.on('end', () => {
		logger.log('Connetion with kernel closed.');
	});
	kernelConnection.on('error', (err) => {
		logger.error('Connection error:', err);
	});

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
};
const prepareWS = async () => {};

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
