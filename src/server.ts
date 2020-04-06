import * as express from 'express';
import { join } from 'path';

import * as bodyParser from 'body-parser';
import * as logger from 'morgan';
import * as cors from 'cors';
//import * as expressJwt from 'express-jwt';
//import { adminRoutes } from './admin';
//import { authRoutes } from './auth';
import { apiRoutes } from './api';
import { FormlyRenderer } from './formlybuilder';

//import { uploadRoutes } from './upload';
//import { contactsRoutes } from './contacts';
//import { generateSitemap } from './sitemap';
import * as SocketIO from 'socket.io';
import { FileSystemDataSource } from './filesystem';

var program = require('commander');

// Express server
async function main() { // jshint ignore:line
  // jshint ignore:line
  const app = express();
  const http = require('http');
  const server = http.createServer(app) // io requires raw http
  const io = SocketIO(server) // Setup Socket.io's server
  const PORT = process.env.PORT || 4000;
  const DIST_FOLDER = join(process.cwd(), 'dist');

  const renderer = new FormlyRenderer(
    // jshint ignore:line
    join(program.args[0]),
    join(program.args[1])
  );

  //renderer.registerProxy('filesystem', new FileSystemDataSource(DIST_FOLDER));
  await renderer.connect(); // jshint ignore:line

  //const autoinquirer = new AutoInquirer(config.dispatcher);

  app.use(
    cors({
      credentials: true
    })
  );
  app.use(bodyParser.json({ strict: false }));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(logger('dev'));
  //app.use(
  //  expressJwt({
  //    secret: config.secret,
  //    credentialsRequired: false
  //  })
  //);

  // Catch all other routes and return the index file
  //app.use('/admin', adminRoutes(ADMIN_FOLDER));
  //app.use('/auth', authRoutes(config));
  //app.use('/contacts', contactsRoutes());

  // Example Express Rest API endpoints
  //app.use('/api/files', uploadRoutes(UPLOAD_FOLDER));
  /*
  io.on("connection", (socket) => {
    autoinquirer.on('prompt', prompt => {
        //console.log('Prompt: ' + JSON.stringify(prompt));
        socket.broadcast.emit("prompt", prompt);
    });
    autoinquirer.on('error', state => { 
        socket.broadcast.emit('error', state)
    });
    autoinquirer.on('exit', state => socket.broadcast.emit('exit', state));
    autoinquirer.on('complete', () => config.dispatcher.close() );
    socket.on('answer', (data) => {
      //console.log('Answer: ' + JSON.stringify(data));
      autoinquirer.onAnswer(data).then(() => autoinquirer.run());
    });
    autoinquirer.run();
  });
  */
  app.use('/api', apiRoutes(renderer));

  // Server static files from /browser
  app.get(
    '*.*',
    express.static(DIST_FOLDER, {
      maxAge: '1y'
    })
  );

  // All regular routes use the Universal engine
  app.get('*', (req, res) => {
    res.sendFile(join(DIST_FOLDER, 'index.html'));
  });

  // Start up the Node server
  server.listen(PORT, () => {
    console.log(`Node Express server listening on http://localhost:${PORT}`);
  });

  process.on('unhandledRejection', (err, p) => {
    console.log('An unhandledRejection occurred');
    console.log(`Rejected Promise: ${p}`);
    console.log(`Rejection:`, err);
    // dispatcher.close();
  });
}

program
  .version('1.0.0')
  .description('Example json editor')
  .arguments('<schemaFile> <dataFile>')
  .parse(process.argv);

if (program.args.length < 1) {
    program.outputHelp();
} else {
    main();
}
