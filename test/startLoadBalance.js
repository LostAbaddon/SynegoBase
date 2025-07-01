require('../common/logger');
const logger = new Logger('LoadBalance');

const SynegoBase = require('../');

SynegoBase.setupNginx("./config4LB.json")
.then(() => {
	logger.log('Nginx DONE');
})
.catch((err) => {
	logger.error('Nginx ERROR');
	logger.error(err);
});