app.post(config.upload.urlpath, async (req, res) => {
	const logger = new Logger('Kernel:Uploader');
	const tempFilePath = req.headers['x-file-path'];
	const contentTypeHeader = req.headers['x-content-type']; // Nginx passes original Content-Type here

	// --- Scenario 1: Request is proxied from Nginx ---
	if (tempFilePath && contentTypeHeader) {
		logger.info('New Upload Request (from Nginx): ' + tempFilePath);

		// Verify the temporary file from Nginx exists before we start
		if (!(await fileExists(tempFilePath))) {
			logger.error('  - Error: Temp file specified by Nginx not found.');
			return res.status(400).json({ code: 404, error: 'Uploaded temp file not found.' });
		}

		try {
			// Initialize busboy with the original headers passed by Nginx
			const bb = busboy({ headers: { 'content-type': contentTypeHeader } });
			
			// Create a read stream FROM THE TEMP FILE, not from the request
			const fileStream = fs.createReadStream(tempFilePath);

			bb.on('file', (fieldname, file, info) => {
				const { filename } = info;
				const safeFilename = path.basename(filename);
				const uniqueFilename = `${Date.now()}-${safeFilename}`;
				const permanentPath = path.join(uploadsDir, uniqueFilename);
				logger.log(`  - Saving to: ${permanentPath}`);

				const writeStream = fs.createWriteStream(permanentPath);
				file.pipe(writeStream);

				writeStream.on('finish', () => {
					const publicUrl = path.join('/', config.upload.filepath, uniqueFilename).replace(/\\/g, '/');
					if (!res.headersSent) {
						res.json({ success: true, url: publicUrl });
					}
				});
			});

			bb.on('error', (err) => {
				logger.error(`  - Busboy error while processing temp file: ${err.message}`);
				if (!res.headersSent) {
					res.status(500).json({ code: 500, error: 'Error processing uploaded file data.' });
				}
				fileStream.destroy(); // Stop reading the file on error
			});

			bb.on('close', () => {
				// This event fires after all parts have been processed.
				// Now it's safe to delete the temporary file.
				fs.unlink(tempFilePath, (err) => {
					if (err) logger.error(`  - Error deleting temp file: ${err.message}`);
					else logger.log(`  - Deleted temp file: ${tempFilePath}`);
				});
				logger.log('Finished processing temp file.');
			});

			// *** The Core Fix ***
			// Pipe the file stream from Nginx's temp file into busboy
			fileStream.pipe(bb);

		} catch (err) {
			logger.error(`  - Critical error setting up busboy for temp file: ${err.message}`);
			if (!res.headersSent) {
				res.status(500).json({ code: 500, error: 'Internal server error during upload setup.' });
			}
		}
		return; // End execution for the Nginx case
	}

	// --- Scenario 2: Direct browser upload (no Nginx proxy) ---
	logger.info('New Upload Request (Direct)');
	const bb = busboy({ headers: req.headers });

	bb.on('file', (fieldname, file, info) => {
		const { filename } = info;
		const safeFilename = path.basename(filename);
		const uniqueFilename = `${Date.now()}-${safeFilename}`;
		const permanentPath = path.join(uploadsDir, uniqueFilename);
		logger.log(`  - Saving to: ${permanentPath}`);
		const writeStream = fs.createWriteStream(permanentPath);
		file.pipe(writeStream);
		writeStream.on('finish', () => {
			const publicUrl = path.join('/', config.upload.filepath, uniqueFilename).replace(/\\/g, '/');
			res.json({ success: true, url: publicUrl });
		});
	});

	bb.on('error', (err) => {
		logger.error(`  - Busboy error (Direct): ${err.message}`);
		if (!res.headersSent) {
			res.status(500).json({ code: 500, error: 'Error processing upload.' });
		}
	});

	req.pipe(bb);
});