const path = require('path');
const fsp = require('fs').promises;
const { Worker } = require('worker_threads');

const logger = new Logger('EventCenter');

const EventHandlerList = [];
const ThreadPool = {};
const TaskPool = {};

const loadHandlersInFolder = async (filelist, folderPath) => {
	const indexFile = path.join(folderPath, 'index.js');
	if (await fileExists(indexFile)) {
		filelist.push(indexFile);
	}
	else {
		let list = await fsp.readdir(folderPath);
		let folders = [];
		await Promise.all(list.map(async filename => {
			const filepath = path.join(folderPath, filename);
			const status = await fsp.lstat(filepath);
			if (status.isDirectory()) return folders.push(filepath);
			else if (!status.isFile()) return;
			if (!filename.match(/\.js$/i)) return;
			filelist.push(filepath);
		}));
		await Promise.all(folders.map(async folderpath => {
			await loadHandlersInFolder(filelist, folderpath, logger);
		}));
	}
};
const amountHandlerFile = async (filepath) => {
	delete require.cache[filepath];
	const block = require(filepath);
	if (!isArray(block.handlers)) {
		delete require.cache[filepath];
		return;
	}

	// 注册响应服务
	block.handlers.forEach(handler => {
		if (!handler.url || !handler.handler || !handler.name) return;
		if (!isArray(handler.protocol) || handler.protocol.length === 0) handler.protocol = null;
		if (!isArray(handler.methods) || handler.methods.length === 0) handler.methods = null;
		if (!isBoolean(handler.onlyFullPath)) handler.onlyFullPath = false;
		if (!(handler.concurrent > 0)) handler.concurrent = 0;
		if (!(handler.threadMode > 0)) handler.threadMode = 0;
		else handler.threadMode = Math.floor(Math.min(handler.threadMode, 3));
		handler.threadMode = 2;
		handler.running = 0;
		handler.pendding = [];
		handler.wait = () => new Promise(res => handler.pendding.push(res));
		handler.filepath = filepath;
		EventHandlerList.push(handler);

		if (handler.threadMode === 2) {
			createThreadPool(handler);
		}
	});
};

const loadHandlers = async (folderPath) => {
	if (folderPath.match(/^\./)) folderPath = path.join(process.cwd(), folderPath);

	// 获取所有需要加载的响应实体文件，且如果一个文件夹中有 index.js 文件则只加载它，否则加载文件夹内所有 js 文件
	const fileList = [];
	await loadHandlersInFolder(fileList, folderPath, logger);

	// 加载这些文件
	await Promise.all(fileList.map(async file => await amountHandlerFile(file)));
};
const callHandlerInThread = (handler, request) => new Promise((res, rej) => {
	const data = {};
	for (let key in request) {
		if (key === 'sender') continue;
		data[key] = request[key];
	}
	const worker = new Worker(path.resolve(__dirname, 'ontimeWorkerMonitor.js'), {
		workerData: {
			js: handler.filepath,
			name: handler.name,
			data
		}
	});
	worker.on('message', msg => {
		if (msg.success) {
			res(msg.data);
		}
		else {
			rej(msg);
		}
		worker.terminate();
	});
	worker.on('error', err => {
		const logger = new Logger('OnceWorker');
		logger.error('Once Worker Error:', err);
		rej(err);
	});
});
const callHandlerInPool = (handler, request) => new Promise((res, rej) => {
	const data = {};
	for (let key in request) {
		if (key === 'sender') continue;
		data[key] = request[key];
	}

	const tag = handler.file + '::' + handler.name;
	const worker = ThreadPool[tag];
	if (!worker) {
		return rej({
			code: 500,
			error: "Missing Handler",
		});
	}

	const tid = newID();
	TaskPool[tid] = {res, rej};
	worker.postMessage({ event: 'task', tid, data });
});
const createThreadPool = handler => {
	const logger = new Logger('ThreadPool');
	const worker = new Worker(path.resolve(__dirname, 'threadPoolMonitor.js'), {
		workerData: {
			js: handler.filepath,
			name: handler.name,
		}
	});
	worker.on('message', msg => {
		if (msg.event === '/amount') {
			if (msg.success) {
				const tag = handler.file + '::' + handler.name;
				if (!!ThreadPool[tag]) ThreadPool[tag].terminate();
				ThreadPool[tag] = worker;
				logger.log('Handler (' + handler.js + ' :: ' + handler.name + ' Amount Successfully!');
			}
			else {
				logger.warn('Amount Handler (' + handler.js + ' :: ' + handler.name + ' Failed!');
				worker.terminate();
			}
		}
		else if (msg.event === '/reply') {
			const promise = TaskPool[msg.tid];
			delete TaskPool[msg.tid];
			if (!!promise) {
				if (msg.reply.success) {
					promise.res(msg.reply.data);
				}
				else {
					promise.rej(msg.reply);
				}
			}
		}
	});
	worker.on('error', err => {
		logger.error('Thread Pool Error:', err);
	});
	worker.on('close', () => {
		const tag = handler.file + '::' + handler.name;
		delete ThreadPool[tag];
		logger.error('Thread Worker ' + handler.file + '::' + handler.name + ' Closed');
		createThreadPool(handler);
	});
};
const callHandler = async (handler, request) => {
	try {
		let reply;
		if (handler.threadMode === 0) {
			reply = await handler.handler(request.body, request.url, request.query, request.params, request.protocol, request.method, request.remoteIP, request.host);
		}
		else if (handler.threadMode === 1) {
			reply = await callHandlerInThread(handler, request);
		}
		else if (handler.threadMode === 2) {
			reply = await callHandlerInPool(handler, request);
		}
		return reply;
	}
	catch (err) {
		logger.error('Call Service Handler Failed:', err);
		return {
			code: 500,
			error: "service down..."
		}
	}
};
const invokeHandler = async (request) => {
	const handlers = EventHandlerList.filter(handler => {
		if (handler.onlyFullPath) {
			if (handler.url !== request.url) return;
		}
		else {
			if (request.url.indexOf(handler.url) !== 0) return;
		}
		if (!!handler.protocol && !handler.protocol.includes(request.protocol)) return;
		if (!!handler.methods && !handler.methods.includes(request.method)) return;
		return true;
	});
	if (handlers.length === 0) return {
		code: 404,
		error: "No such service",
	}

	handlers.sort((ha, hb) => hb.url.length - ha.url.length);
	const targetHandler = handlers[0];
	if (targetHandler.concurrent > 0 && targetHandler.running >= targetHandler.concurrent) {
		await targetHandler.wait();
	}

	targetHandler.running ++;
	const reply = await callHandler(targetHandler, request);
	let needWait = true;
	if (targetHandler.pendding.length === 0) {
		targetHandler.running --;
		needWait = false;
	}
	if (needWait) {
		wait(50).then(() => {
			targetHandler.running --;
			if (targetHandler.pendding.length === 0) return;
			if (targetHandler.running >= targetHandler.concurrent) return;
			const res = targetHandler.pendding.shift();
			res();
		});
	}
	return reply;
};
const getServiceList = () => EventHandlerList.map(handler => {
	return {
		protocol: handler.protocol,
		methods: handler.methods,
		url: handler.url,
		onlyFullPath: handler.onlyFullPath,
	}
});

module.exports = {
	amount: loadHandlers,
	getServiceList,
	invoke: invokeHandler,
};