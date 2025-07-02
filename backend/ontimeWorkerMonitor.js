const { parentPort, workerData, threadId } = require('worker_threads');
require('../common/logger'); // 富文本 console 工具
const logger = new Logger('OnceWorker:' + process.pid + ':' + threadId);

const doJob = async () => {
	let handler = require(workerData.js);
	if (!handler || !handler.handlers) {
		parentPort.postMessage({
			code: 500,
			error: "Invalid Handler File",
		});
		return;
	}
	handler = handler.handlers.filter(h => h.name === workerData.name)[0];
	if (!handler) {
		parentPort.postMessage({
			code: 500,
			error: "Invalid Handler Name",
		});
		return;
	}

	try {
		const data = workerData.data;
		const reply = await handler.handler(data.body, data.url, data.query, data.params, data.protocol, data.method, data.remoteIP, data.host);
		parentPort.postMessage({
			success: true,
			result: reply,
		});
	}
	catch (err) {
		logger.error('Do Task Failed:', err);
		parentPort.postMessage({
			code: 500,
			error: "worker down...",
		});
	}
};

doJob();