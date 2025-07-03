const path = require('path');
const fsp = require('fs').promises;
const { Worker } = require('worker_threads');

const logger = new Logger('EventCenter');

const EventHandlerList = [];
const ThreadPool = {};
const TaskPool = {};

const loadHandlersInFolder = async (filelist, folderPath) => {
	if (!(await fileExists(folderPath))) return;

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
		handler.actionName = filepath + '::' + handler.name;
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

	const worker = ThreadPool[handler.actionName];
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
				if (!!ThreadPool[handler.actionName]) ThreadPool[handler.actionName].terminate();
				ThreadPool[handler.actionName] = worker;
				logger.log('Handler (' + handler.filepath + ' :: ' + handler.name + ') Amount Successfully!');
			}
			else {
				logger.warn('Amount Handler (' + handler.filepath + ' :: ' + handler.name + ' Failed!');
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
		delete ThreadPool[handler.actionName];
		logger.error('Thread Worker ' + handler.filepath + '::' + handler.name + ' Closed');
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
const activeHandler = async (handler, request) => {
	if (handler.concurrent > 0 && handler.running >= handler.concurrent) {
		await handler.wait();
	}

	handler.running ++;
	const reply = await callHandler(handler, request);
	let needWait = true;
	if (handler.pendding.length === 0) {
		handler.running --;
		needWait = false;
	}
	if (needWait) {
		wait(50).then(() => {
			handler.running --;
			if (handler.pendding.length === 0) return;
			if (handler.running >= handler.concurrent) return;
			const res = handler.pendding.shift();
			res();
		});
	}

	return reply;
};
const invokeHandler = async (request, onlyOne=true) => {
	let handlers;
	if (isString(onlyOne)) {
		handlers = EventHandlerList.filter(handler => {
			return handler.actionName === onlyOne;
		}).map(handler => {
			return [0, 0, handler];
		});
		if (handlers.length === 0) return {
			code: 404,
			error: "No such service",
		}
	}
	else {
		handlers = EventHandlerList.filter(handler => {
			if (handler.onlyFullPath) {
				if (handler.url !== request.url) return;
			}
			else {
				if (request.url.indexOf(handler.url) !== 0) return;
			}
			if (!!handler.protocol && !handler.protocol.includes(request.protocol)) return;
			if (!!handler.methods && !handler.methods.includes(request.method)) return;
			return true;
		}).map(handler => {
			const level = handler.url.split('/').filter(p => !!p).length;
			return [level, handler.url.length, handler];
		});
		if (handlers.length === 0) return {
			code: 404,
			error: "No such service",
		}
	}

	let reply;
	if (onlyOne) {
		handlers.sort((ha, hb) => {
			let diff = hb[0] - ha[0];
			if (diff !== 0) return diff;
			return hb[1] - ha[1];
		});
		reply = await activeHandler(handlers[0][2], request);
	}
	else {
		handlers.sort((ha, hb) => {
			let diff = ha[0] - hb[0];
			if (diff !== 0) return diff;
			return ha[1] - hb[1];
		});
		for (let item of handlers) {
			const handler = item[2];
			reply = await activeHandler(handler, request);
			if (!!reply.code) break;
		}
	}
	return reply;
};
const getServiceList = () => EventHandlerList.map(handler => {
	return {
		protocol: handler.protocol,
		methods: handler.methods,
		url: handler.url,
		onlyFullPath: handler.onlyFullPath,
		handlerName: handler.filepath + '::' + handler.name,
	}
});

module.exports = {
	amount: loadHandlers,
	getServiceList,
	invoke: invokeHandler,
};