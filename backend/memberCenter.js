const DecayRate = 0.2;
const ReDecayRate = 1 - DecayRate;

const logger = new Logger('MemberCenter');

const MemberGroup = {};

const appendNode = async (data, sender) => {
	logger.info(' SignIn:', sender.id, data.nid);
	MemberGroup[sender.id] = {
		sender,
		serviceList: data.data.serviceList,
	};
};
const removeNode = async (sid) => {
	logger.info('SignOut:', sid);
	delete MemberGroup[sid];
};
const invokeNode = async (request) => {
	// 筛选响应事件
	let handlerList = {};
	Object.values(MemberGroup).forEach(member => {
		member.serviceList.forEach(service => {
			if (service.onlyFullPath) {
				if (service.url !== request.url) return;
			}
			else {
				if (request.url.indexOf(service.url) !== 0) return;
			}
			if (!!service.protocol && !service.protocol.includes(request.protocol)) return;
			if (!!service.methods && !service.methods.includes(request.method)) return;

			if (!handlerList[service.url]) handlerList[service.url] = [];
			handlerList[service.url].push([member, service.handlerName]);
		});
	});
	handlerList = Object.keys(handlerList).map(url => {
		const item = handlerList[url];
		const level = url.split('/').filter(p => !!p).length;
		return [url, level, url.length, item];
	});
	if (handlerList.length === 0) {
		return {
			code: 404,
			error: "no such service",
		}
	}
	handlerList.sort((ha, hb) => {
		let diff = hb[1] - ha[1];
		if (diff !== 0) return diff;
		return hb[2] - ha[2];
	});
	handlerList = handlerList[0][3];

	// 筛选响应实体
	let actionHandler = [];
	handlerList.forEach(item => {
		const [handler, actionPath] = item;
		const actor = handler.serviceList.filter(service => service.handlerName === actionPath)[0];
		if (!actor.running) actor.running = 0;
		if (!actor.amount) actor.amount = 0;
		if (!actor.timespent) actor.timespent = 0;
		const score = actor.timespent * ((actor.running + actor.amount / 100) + 2);
		actionHandler.push([score, handler.sender, actor, actionPath]);
	});
	actionHandler.sort((aa, ab) => aa[0] - ab[0]);
	actionHandler = actionHandler[0];

	// 呼叫响应实体
	actionHandler[2].running ++;
	let time = Date.now(), reply;
	try {
		reply = await callAndWait(actionHandler[1], actionHandler[3], request);
	}
	catch (err) {
		logger.error('Call Worker Error:', err);
		reply = {
			code: 500,
			error: "something wrong inside worker node...",
		};
	}
	time = Date.now() - time;
	actionHandler[2].running --;
	actionHandler[2].amount ++;
	actionHandler[2].timespent = time * DecayRate + actionHandler[2].timespent * ReDecayRate;

	if (!!reply.code) return reply;
	return reply.data;
};

/* 派发任务相关 */
const Penddings = {};
const callAndWait = (actionHandler, actionPath, request) => new Promise((res, rej) => {
	const tid = newID();
	Penddings[tid] = {res, rej};
	actionHandler({
		event: "/invokeAction",
		tid,
		data: { actionPath, request }
	});
});
const resumePending = (tid, reply) => {
	const promise = Penddings[tid];
	if (!promise) {
		logger.warn('Missing Promise for task ' + tid);
		return;
	}

	delete Penddings[tid];
	if (!!reply.code) {
		promise.rej(reply);
	}
	else {
		promise.res(reply);
	}
};

module.exports = {
	signIn: appendNode,
	signOut: removeNode,
	invoke: invokeNode,
	resume: resumePending,
};