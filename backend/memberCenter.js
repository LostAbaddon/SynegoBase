const logger = new Logger('MemberCenter');

const MemberGroup = {};

const appendNode = async (data, sender) => {
	logger.info(' SignIn:', sender.id, data.nid);
	MemberGroup[sender.id] = {sender, serviceList: data.data.serviceList};
	console.dir(MemberGroup, {depth: 100});
};
const removeNode = async (sid) => {
	logger.info('SignOut:', sid);
	delete MemberGroup[sid];
};
const invokeNode = async (request) => {};

module.exports = {
	signIn: appendNode,
	signOut: removeNode,
	invoke: invokeNode,
};