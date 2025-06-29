const nginxManager = require('./nginx/nginx-manager');

/**
 * The main public API for the SynegoBase library.
 */
module.exports = {
  /**
   * Sets up and configures Nginx based on a user-provided configuration.
   * This function will:
   * 1. Check if Nginx is installed, and prompt for automatic installation if not.
   * 2. Merge the user's configuration with default settings.
   * 3. Generate a new nginx.conf file.
   * 4. Place the new configuration in the correct system location, backing up the old one.
   *
   * @param {object} [userConfig={}] - A configuration object to override default settings.
   *   See `configExample/nginx.config.example.json` for all available options.
   * @param {string} [callingProjectRoot=process.cwd()] - The absolute path to the root of the project
   *   that is *using* this library. This is crucial for resolving relative paths in the config.
   * @returns {Promise<void>} A promise that resolves when the setup is complete.
   */
  setupNginx: nginxManager.setupNginx,

  /**
   * Controls the Nginx service.
   * @param {'start'|'stop'|'restart'} action - The action to perform on the Nginx service.
   */
  controlNginx: nginxManager.controlNginx,
};
