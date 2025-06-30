const http = require('http');
const fs = require('fs');
const path = require('path');
const busboy = require('busboy');

require('../common/logger');
const logger = new Logger('Uploader');

const server = http.createServer((req, res) => {
	if (req.url === '/upload-callback' && (req.method === 'POST' || req.method === 'PUT')) {
		const tempFilePath = req.headers['x-file-path'];

		if (!tempFilePath || !fs.existsSync(tempFilePath)) {
			logger.error('  - Error: Temp file not found at the specified path.');
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ message: 'Error: Temp file not found.' }));
			return;
		}

		logger.log('File upload callback received:');
		logger.log(`  - Temp File Path: ${tempFilePath}`);

		const bb = busboy({ headers: req.headers });
		let originalFilename = 'unknown_file';
		let permanentPath = '';

		bb.on('file', (fieldname, file, info) => {
			const { filename, encoding, mimeType } = info;
			originalFilename = filename;
			// Sanitize filename to prevent directory traversal attacks
			const safeFilename = path.basename(originalFilename);
			// Create a unique filename to avoid overwrites
			const uniqueFilename = `${Date.now()}-${safeFilename}`;
			const uploadsDir = path.join(__dirname, 'uploads');

			// Ensure the 'uploads' directory exists
			fs.mkdirSync(uploadsDir, { recursive: true });
			permanentPath = path.join(uploadsDir, uniqueFilename);

			logger.log(`  - Parsing file: ${originalFilename}`);
			logger.log(`  - Saving to: ${permanentPath}`);

			const writeStream = fs.createWriteStream(permanentPath);
			file.pipe(writeStream);
		});

		bb.on('close', () => {
            logger.log('  - Busboy finished parsing.');
            // The temporary file from Nginx is no longer needed
            fs.unlink(tempFilePath, (err) => {
                if (err) logger.error(`  - Error deleting temp file: ${err.message}`);
                else logger.log(`  - Successfully deleted temp file: ${tempFilePath}`);
            });

            // Construct a public URL instead of a file system path
            const publicUrl = path.join('/uploads', path.basename(permanentPath)).replace(/\\/g, '/');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
				success: true,
				message: "File uploaded successfully.",
                url: publicUrl,
            }));
        });
		
		bb.on('error', (err) => {
			logger.error(`  - Busboy error: ${err.message}`);
			fs.unlink(tempFilePath, () => {}); // Clean up temp file on error
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ code: 500, error: 'Error processing upload.' }));
		});

		// We pipe the *actual* temporary file stream from Nginx into Busboy
		const tempFileStream = fs.createReadStream(tempFilePath);
		tempFileStream.pipe(bb);
	}
	else {
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not Found');
	}
});

const PORT = 3000;
server.listen(PORT, () => {
	logger.log(`Backend server listening on port ${PORT}`);
	logger.log('Ready to receive upload callbacks from Nginx (now with Busboy).');
});
