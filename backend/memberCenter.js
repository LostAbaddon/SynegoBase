const logger = new Logger('MemberCenter');

const MemberGroup = {};

const appendNode = async (data, sender) => {
	logger.info(' SignIn:', sender.id, data);
	MemberGroup[sender.id] = {
		sender,
	};
};
const removeNode = async (sid) => {
	logger.info('SignOut:', sid);
	delete MemberGroup[sid];
};

module.exports = {
	signIn: appendNode,
	signOut: removeNode,
};