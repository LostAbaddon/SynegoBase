require('../common/logger');
const logger = new Logger('Starter');

const SynegoBase = require('../');

SynegoBase.setupNginx("./config1.json")
.then(() => {
	logger.log('Nginx DONE');
})
.catch((err) => {
	logger.error('Nginx ERROR');
	logger.error(err);
});